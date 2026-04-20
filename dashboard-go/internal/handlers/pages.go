package handlers

import (
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"safeguard-dashboard/internal/auth"
	"safeguard-dashboard/internal/middleware"
	"safeguard-dashboard/internal/permissions"
	"safeguard-dashboard/internal/websocket"
)

// ─── PageData ───────────────────────────────────────────

// PageData carries all data needed by HTML templates.
type PageData struct {
	Title      string
	User       *PageUser
	SchoolID   string
	SchoolName string
	Page       string // current page identifier for nav highlighting
	Error      string
	Data       interface{} // page-specific data
}

// PageUser is a template-friendly user representation.
type PageUser struct {
	ID       string
	Email    string
	Name     string
	Role     string
	SchoolID string
	Active   bool
}

// ─── PageHandlers ───────────────────────────────────────

// PageHandlers serves HTML pages using Go templates.
type PageHandlers struct {
	Pool      *pgxpool.Pool
	Hub       *websocket.Hub
	templates *template.Template
}

// NewPageHandlers creates a PageHandlers instance and parses all templates.
func NewPageHandlers(pool *pgxpool.Pool, hub *websocket.Hub) *PageHandlers {
	funcMap := template.FuncMap{
		"eq": func(a, b interface{}) bool {
			return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
		},
		"ne": func(a, b interface{}) bool {
			return fmt.Sprintf("%v", a) != fmt.Sprintf("%v", b)
		},
		"contains": func(s, substr string) bool {
			return strings.Contains(s, substr)
		},
		"json": func(v interface{}) template.JS {
			b, err := json.Marshal(v)
			if err != nil {
				return template.JS("{}")
			}
			return template.JS(b)
		},
		"timeAgo": func(t time.Time) string {
			d := time.Since(t)
			switch {
			case d < time.Minute:
				return "just now"
			case d < time.Hour:
				m := int(d.Minutes())
				if m == 1 {
					return "1 minute ago"
				}
				return fmt.Sprintf("%d minutes ago", m)
			case d < 24*time.Hour:
				h := int(d.Hours())
				if h == 1 {
					return "1 hour ago"
				}
				return fmt.Sprintf("%d hours ago", h)
			default:
				days := int(d.Hours() / 24)
				if days == 1 {
					return "1 day ago"
				}
				return fmt.Sprintf("%d days ago", days)
			}
		},
		"upper": strings.ToUpper,
		"lower": strings.ToLower,
		"hasPrefix": func(s, prefix string) bool {
			return strings.HasPrefix(s, prefix)
		},
	}

	// Parse all templates with layouts
	tmpl := template.Must(template.New("").Funcs(funcMap).ParseGlob(
		filepath.Join("templates", "layouts", "*.html"),
	))
	tmpl = template.Must(tmpl.ParseGlob(
		filepath.Join("templates", "auth", "*.html"),
	))
	tmpl = template.Must(tmpl.ParseGlob(
		filepath.Join("templates", "school", "*.html"),
	))
	tmpl = template.Must(tmpl.ParseGlob(
		filepath.Join("templates", "ops", "*.html"),
	))

	return &PageHandlers{
		Pool:      pool,
		Hub:       hub,
		templates: tmpl,
	}
}

// ─── Render helpers ─────────────────────────────────────

func (p *PageHandlers) render(w http.ResponseWriter, tmplName string, data PageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := p.templates.ExecuteTemplate(w, tmplName, data); err != nil {
		log.Printf("[Pages] Template render error (%s): %v", tmplName, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}
}

func sessionToPageUser(s *auth.SessionUser) *PageUser {
	if s == nil {
		return nil
	}
	return &PageUser{
		ID:       s.ID,
		Email:    s.Email,
		Name:     s.Name,
		Role:     s.Role,
		SchoolID: s.SchoolID,
		Active:   s.Active,
	}
}

// redirectToLogin sends the user to the login page.
func redirectToLogin(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

// ─── Public pages ───────────────────────────────────────

// LoginPage renders the login form.
func (p *PageHandlers) LoginPage(w http.ResponseWriter, r *http.Request) {
	// If already logged in, redirect
	user := middleware.GetSession(r.Context())
	if user != nil {
		redirect := permissions.GetLoginRedirect(user.Role)
		http.Redirect(w, r, redirect, http.StatusSeeOther)
		return
	}

	p.render(w, "login.html", PageData{
		Title: "Login — SafeGuard",
		Page:  "login",
	})
}

// ─── Root redirect ──────────────────────────────────────

// RootRedirect redirects based on role.
func (p *PageHandlers) RootRedirect(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	redirect := permissions.GetLoginRedirect(user.Role)
	http.Redirect(w, r, redirect, http.StatusSeeOther)
}

// ─── School portal pages ────────────────────────────────

// SchoolDashboardPage renders the school dashboard.
func (p *PageHandlers) SchoolDashboardPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	// Ops users without a school context get redirected
	if permissions.IsOpsRole(user.Role) && user.SchoolID == "" {
		http.Redirect(w, r, "/ops/dashboard", http.StatusSeeOther)
		return
	}

	schoolName := p.getSchoolName(r, user.SchoolID)

	p.render(w, "school_dashboard.html", PageData{
		Title:      "Dashboard — SafeGuard",
		User:       sessionToPageUser(user),
		SchoolID:   user.SchoolID,
		SchoolName: schoolName,
		Page:       "dashboard",
	})
}

// CamerasPage renders the cameras view.
func (p *PageHandlers) CamerasPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if permissions.IsOpsRole(user.Role) && user.SchoolID == "" {
		http.Redirect(w, r, "/ops/dashboard", http.StatusSeeOther)
		return
	}

	schoolName := p.getSchoolName(r, user.SchoolID)

	p.render(w, "school_cameras.html", PageData{
		Title:      "Cameras — SafeGuard",
		User:       sessionToPageUser(user),
		SchoolID:   user.SchoolID,
		SchoolName: schoolName,
		Page:       "cameras",
	})
}

// SchoolAlertsPage renders the school alerts view.
func (p *PageHandlers) SchoolAlertsPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if permissions.IsOpsRole(user.Role) && user.SchoolID == "" {
		http.Redirect(w, r, "/ops/alerts", http.StatusSeeOther)
		return
	}

	schoolName := p.getSchoolName(r, user.SchoolID)

	p.render(w, "school_alerts.html", PageData{
		Title:      "Alerts — SafeGuard",
		User:       sessionToPageUser(user),
		SchoolID:   user.SchoolID,
		SchoolName: schoolName,
		Page:       "alerts",
	})
}

// ManagementPage renders the camera management view.
func (p *PageHandlers) ManagementPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if permissions.IsOpsRole(user.Role) && user.SchoolID == "" {
		http.Redirect(w, r, "/ops/dashboard", http.StatusSeeOther)
		return
	}

	schoolName := p.getSchoolName(r, user.SchoolID)

	p.render(w, "school_management.html", PageData{
		Title:      "Management — SafeGuard",
		User:       sessionToPageUser(user),
		SchoolID:   user.SchoolID,
		SchoolName: schoolName,
		Page:       "management",
	})
}

// UsersPage renders the user management view.
func (p *PageHandlers) UsersPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if permissions.IsOpsRole(user.Role) && user.SchoolID == "" {
		http.Redirect(w, r, "/ops/users", http.StatusSeeOther)
		return
	}

	schoolName := p.getSchoolName(r, user.SchoolID)

	p.render(w, "school_users.html", PageData{
		Title:      "Users — SafeGuard",
		User:       sessionToPageUser(user),
		SchoolID:   user.SchoolID,
		SchoolName: schoolName,
		Page:       "users",
	})
}

// ─── Ops portal pages ───────────────────────────────────

// OpsDashboardPage renders the ops overview.
func (p *PageHandlers) OpsDashboardPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if !permissions.IsOpsRole(user.Role) {
		http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
		return
	}

	p.render(w, "ops_dashboard.html", PageData{
		Title: "Ops Dashboard — SafeGuard",
		User:  sessionToPageUser(user),
		Page:  "ops-dashboard",
	})
}

// OpsSchoolsPage renders the schools list.
func (p *PageHandlers) OpsSchoolsPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if !permissions.IsOpsRole(user.Role) {
		http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
		return
	}

	p.render(w, "ops_schools.html", PageData{
		Title: "Schools — SafeGuard Ops",
		User:  sessionToPageUser(user),
		Page:  "ops-schools",
	})
}

// OpsSchoolDetailPage renders a school detail view.
func (p *PageHandlers) OpsSchoolDetailPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if !permissions.IsOpsRole(user.Role) {
		http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
		return
	}

	schoolID := r.PathValue("id")

	p.render(w, "ops_school_detail.html", PageData{
		Title:    "School Detail — SafeGuard Ops",
		User:     sessionToPageUser(user),
		SchoolID: schoolID,
		Page:     "ops-schools",
	})
}

// OpsSchoolSettingsPage renders a school settings view.
func (p *PageHandlers) OpsSchoolSettingsPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if !permissions.IsOpsRole(user.Role) {
		http.Redirect(w, r, "/dashboard", http.StatusSeeOther)
		return
	}

	schoolID := r.PathValue("id")

	p.render(w, "ops_school_settings.html", PageData{
		Title:    "School Settings — SafeGuard Ops",
		User:     sessionToPageUser(user),
		SchoolID: schoolID,
		Page:     "ops-schools",
	})
}

// OpsAlertsPage renders the cross-school alert list.
func (p *PageHandlers) OpsAlertsPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if !permissions.IsOpsRole(user.Role) {
		http.Redirect(w, r, "/alerts", http.StatusSeeOther)
		return
	}

	p.render(w, "ops_alerts.html", PageData{
		Title: "Alerts — SafeGuard Ops",
		User:  sessionToPageUser(user),
		Page:  "ops-alerts",
	})
}

// OpsUsersPage renders the cross-school user table.
func (p *PageHandlers) OpsUsersPage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetSession(r.Context())
	if user == nil {
		redirectToLogin(w, r)
		return
	}

	if !permissions.IsOpsRole(user.Role) {
		http.Redirect(w, r, "/users", http.StatusSeeOther)
		return
	}

	p.render(w, "ops_users.html", PageData{
		Title: "Users — SafeGuard Ops",
		User:  sessionToPageUser(user),
		Page:  "ops-users",
	})
}

// ─── Helpers ────────────────────────────────────────────

// getSchoolName looks up the school name by ID. Returns a fallback on error.
func (p *PageHandlers) getSchoolName(r *http.Request, schoolID string) string {
	if schoolID == "" {
		return "Unknown School"
	}

	var name string
	err := p.Pool.QueryRow(r.Context(),
		`SELECT name FROM "School" WHERE id = $1`, schoolID,
	).Scan(&name)
	if err != nil {
		return "School"
	}
	return name
}

package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/middleware"
	"safeguard-dashboard/internal/permissions"
)

// ─── Response Types ─────────────────────────────────────

type alertResponse struct {
	ID        string           `json:"id"`
	Type      string           `json:"type"`
	Title     string           `json:"title"`
	Detail    *string          `json:"detail,omitempty"`
	Resolved  bool             `json:"resolved"`
	CreatedAt string           `json:"createdAt"`
	SchoolID  string           `json:"schoolId"`
	Camera    *alertCameraInfo `json:"camera,omitempty"`
}

type alertCameraInfo struct {
	CameraID string `json:"cameraId"`
	Name     string `json:"name"`
	Zone     string `json:"zone,omitempty"`
}

func alertToResponse(a *database.Alert, cam *database.Camera) alertResponse {
	resp := alertResponse{
		ID:        a.ID,
		Type:      string(a.Type),
		Title:     a.Title,
		Detail:    a.Detail,
		Resolved:  a.Resolved,
		CreatedAt: a.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
		SchoolID:  a.SchoolID,
	}
	if cam != nil {
		resp.Camera = &alertCameraInfo{
			CameraID: cam.CameraID,
			Name:     cam.Name,
			Zone:     cam.Zone,
		}
	}
	return resp
}

// ─── Handlers ───────────────────────────────────────────

// ListAlerts handles GET /api/alerts.
// Returns alerts with optional filters: type, resolved, schoolId, limit, offset.
// School-scoped: school users see only their school's alerts.
// Ops users see all alerts or can filter by schoolId.
func (h *Handlers) ListAlerts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	query := r.URL.Query()
	querySchoolID := query.Get("schoolId")
	alertTypeStr := query.Get("type")
	resolvedStr := query.Get("resolved")
	limitStr := query.Get("limit")
	offsetStr := query.Get("offset")

	// Parse limit/offset with defaults.
	limit := 50
	if limitStr != "" {
		if v, err := strconv.Atoi(limitStr); err == nil && v > 0 {
			limit = v
		}
	}
	offset := 0
	if offsetStr != "" {
		if v, err := strconv.Atoi(offsetStr); err == nil && v >= 0 {
			offset = v
		}
	}

	// Determine school scope.
	var schoolID string
	if permissions.IsOpsRole(user.Role) {
		// Ops users can view all or filter by school.
		schoolID = querySchoolID
	} else {
		// School users can only see their school.
		if user.SchoolID == "" {
			writeError(w, http.StatusBadRequest, "No school context")
			return
		}
		schoolID = user.SchoolID
	}

	// For non-ops users, schoolID is required.
	if schoolID == "" && !permissions.IsOpsRole(user.Role) {
		writeError(w, http.StatusBadRequest, "No school context")
		return
	}

	// Build optional filter params.
	var alertType *database.AlertType
	if alertTypeStr != "" {
		at := database.AlertType(alertTypeStr)
		if at.Valid() {
			alertType = &at
		}
	}

	var resolved *bool
	if resolvedStr != "" {
		v := resolvedStr == "true"
		resolved = &v
	}

	ctx := r.Context()

	var alerts []database.Alert
	var total int
	var err error

	if schoolID == "" && permissions.IsOpsRole(user.Role) {
		// All-schools query for ops users (no school filter).
		alerts, total, err = h.listAlertsAllSchools(ctx, alertType, resolved, limit, offset)
	} else {
		params := database.AlertListParams{
			SchoolID: schoolID,
			Type:     alertType,
			Resolved: resolved,
			Limit:    limit,
			Offset:   offset,
		}
		alerts, err = database.ListAlerts(ctx, params)
		if err == nil {
			total, err = database.CountAlerts(ctx, schoolID, alertType, resolved)
		}
	}

	if err != nil {
		log.Printf("[Alerts] List error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	// Enrich alerts with camera info.
	cameraCache := make(map[string]*database.Camera)
	result := make([]alertResponse, 0, len(alerts))
	for i := range alerts {
		a := &alerts[i]
		var cam *database.Camera
		if a.CameraID != nil {
			cid := *a.CameraID
			if cached, ok := cameraCache[cid]; ok {
				cam = cached
			} else {
				cam, _ = database.FindCameraByID(ctx, cid)
				cameraCache[cid] = cam
			}
		}
		result = append(result, alertToResponse(a, cam))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"alerts": result,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// listAlertsAllSchools queries alerts across all schools (for ops users
// without a schoolId filter). Uses direct pool queries since the standard
// database.ListAlerts requires a schoolID.
func (h *Handlers) listAlertsAllSchools(ctx context.Context, alertType *database.AlertType, resolved *bool, limit, offset int) ([]database.Alert, int, error) {
	var (
		clauses []string
		args    []any
		argIdx  int
	)

	nextArg := func() string {
		argIdx++
		return fmt.Sprintf("$%d", argIdx)
	}

	if alertType != nil {
		clauses = append(clauses, fmt.Sprintf("type = %s", nextArg()))
		args = append(args, *alertType)
	}
	if resolved != nil {
		clauses = append(clauses, fmt.Sprintf("resolved = %s", nextArg()))
		args = append(args, *resolved)
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}

	// Count query.
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM "Alert" %s`, where)
	var total int
	if err := h.Pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count all alerts: %w", err)
	}

	// Data query.
	dataQ := fmt.Sprintf(`
		SELECT id, type, title, detail, resolved, camera_id, school_id, created_at, updated_at
		FROM "Alert" %s
		ORDER BY created_at DESC
		LIMIT %s OFFSET %s`, where, nextArg(), nextArg())
	args = append(args, limit, offset)

	rows, err := h.Pool.Query(ctx, dataQ, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list all alerts: %w", err)
	}
	defer rows.Close()

	var alerts []database.Alert
	for rows.Next() {
		var a database.Alert
		if err := rows.Scan(
			&a.ID, &a.Type, &a.Title, &a.Detail, &a.Resolved,
			&a.CameraID, &a.SchoolID, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan alert: %w", err)
		}
		alerts = append(alerts, a)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate alerts: %w", err)
	}

	return alerts, total, nil
}

// ResolveAlert handles POST /api/alerts/{id}/resolve.
// Marks an alert as resolved. Requires canResolveAlerts permission.
func (h *Handlers) ResolveAlert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	// Check canResolveAlerts permission.
	if !permissions.HasPermission(user.Role, "canResolveAlerts") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	// Extract alert ID from URL path: /api/alerts/{id}/resolve
	id := extractAlertID(r.URL.Path)
	if id == "" {
		writeError(w, http.StatusBadRequest, "Missing alert ID")
		return
	}

	ctx := r.Context()

	// Find the alert.
	const q = `
		SELECT id, type, title, detail, resolved, camera_id, school_id, created_at, updated_at
		FROM "Alert"
		WHERE id = $1`

	var alert database.Alert
	err := h.Pool.QueryRow(ctx, q, id).Scan(
		&alert.ID, &alert.Type, &alert.Title, &alert.Detail, &alert.Resolved,
		&alert.CameraID, &alert.SchoolID, &alert.CreatedAt, &alert.UpdatedAt,
	)
	if err != nil {
		writeError(w, http.StatusNotFound, "Alert not found")
		return
	}

	// School-scoped access check.
	if !permissions.IsOpsRole(user.Role) && alert.SchoolID != user.SchoolID {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	// Already resolved?
	if alert.Resolved {
		var cam *database.Camera
		if alert.CameraID != nil {
			cam, _ = database.FindCameraByID(ctx, *alert.CameraID)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"message": "Alert already resolved",
			"alert":   alertToResponse(&alert, cam),
		})
		return
	}

	// Resolve the alert.
	if err := database.ResolveAlert(ctx, id); err != nil {
		log.Printf("[Alerts] Resolve error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	alert.Resolved = true

	// Enrich with camera info.
	var cam *database.Camera
	if alert.CameraID != nil {
		cam, _ = database.FindCameraByID(ctx, *alert.CameraID)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"alert": alertToResponse(&alert, cam),
	})
}

// extractAlertID extracts the alert ID from a path like /api/alerts/{id}/resolve.
func extractAlertID(path string) string {
	// Expected: /api/alerts/{id}/resolve
	const prefix = "/api/alerts/"
	const suffix = "/resolve"

	if len(path) <= len(prefix)+len(suffix) {
		return ""
	}

	trimmed := path[len(prefix):]
	if idx := len(trimmed) - len(suffix); idx > 0 && trimmed[idx:] == suffix {
		return trimmed[:idx]
	}

	return ""
}

package handlers

import (
	"log"
	"net/http"

	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/featureflags"
	"safeguard-dashboard/internal/middleware"
	"safeguard-dashboard/internal/permissions"
)

// ─── Response Types ─────────────────────────────────────

type schoolListFlags struct {
	LocalStorage bool `json:"localStorage"`
	CloudStorage bool `json:"cloudStorage"`
	RemoteAccess bool `json:"remoteAccess"`
	LocalView    bool `json:"localView"`
}

type schoolListLimits struct {
	RetentionDays int `json:"retentionDays"`
	MaxCameras    int `json:"maxCameras"`
	MaxUsers      int `json:"maxUsers"`
}

type schoolListStats struct {
	CamerasOnline int `json:"camerasOnline"`
	CamerasTotal  int `json:"camerasTotal"`
	UsersCount    int `json:"usersCount"`
	AlertsCount   int `json:"alertsCount"`
}

type schoolListBridge struct {
	Online     bool    `json:"online"`
	LastPingAt *string `json:"lastPingAt,omitempty"`
}

type schoolListItem struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Slug         string            `json:"slug"`
	Address      *string           `json:"address,omitempty"`
	CreatedAt    string            `json:"createdAt"`
	Flags        schoolListFlags   `json:"flags"`
	Limits       schoolListLimits  `json:"limits"`
	Stats        schoolListStats   `json:"stats"`
	StreamBridge *schoolListBridge `json:"streamBridge"`
}

// ─── GET /api/schools ───────────────────────────────────

// ListSchools returns all schools with aggregate stats, feature flags, limits,
// and stream bridge info. Requires canViewAllSchools permission.
func (h *Handlers) ListSchools(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if !permissions.HasPermission(user.Role, "canViewAllSchools") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	ctx := r.Context()

	schools, err := database.ListSchools(ctx)
	if err != nil {
		log.Printf("[Schools] ListSchools error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	// Build response with bridge info.
	items := make([]schoolListItem, 0, len(schools))
	for _, s := range schools {
		item := schoolListItem{
			ID:        s.ID,
			Name:      s.Name,
			Slug:      s.Slug,
			Address:   s.Address,
			CreatedAt: s.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
			Flags: schoolListFlags{
				LocalStorage: s.LocalStorageEnabled,
				CloudStorage: s.CloudStorageEnabled,
				RemoteAccess: s.RemoteAccessEnabled,
				LocalView:    s.LocalViewEnabled,
			},
			Limits: schoolListLimits{
				RetentionDays: s.RetentionDays,
				MaxCameras:    s.MaxCameras,
				MaxUsers:      s.MaxUsers,
			},
			Stats: schoolListStats{
				CamerasOnline: s.OnlineCameraCount,
				CamerasTotal:  s.CameraCount,
				UsersCount:    s.UserCount,
				AlertsCount:   s.AlertCount,
			},
		}

		// Fetch stream bridge status per school.
		bridge, err := database.FindStreamBridgeBySchoolID(ctx, s.ID)
		if err != nil {
			log.Printf("[Schools] Bridge lookup for %s: %v", s.ID, err)
		}
		if bridge != nil {
			sb := schoolListBridge{Online: bridge.Online}
			if bridge.LastPingAt != nil {
				ts := bridge.LastPingAt.Format("2006-01-02T15:04:05.000Z")
				sb.LastPingAt = &ts
			}
			item.StreamBridge = &sb
		}

		items = append(items, item)
	}

	writeJSON(w, http.StatusOK, map[string]any{"schools": items})
}

// ─── GET /api/schools/{id} ──────────────────────────────

type schoolDetailCamera struct {
	ID         string  `json:"id"`
	CameraID   string  `json:"cameraId"`
	Name       string  `json:"name"`
	Zone       string  `json:"zone"`
	Type       string  `json:"type"`
	Resolution string  `json:"resolution"`
	Status     string  `json:"status"`
	LastSeenAt *string `json:"lastSeenAt,omitempty"`
}

type schoolDetailUser struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	Active bool   `json:"active"`
}

type schoolDetailAlert struct {
	ID        string             `json:"id"`
	Type      string             `json:"type"`
	Title     string             `json:"title"`
	CreatedAt string             `json:"createdAt"`
	Camera    *alertCameraDetail `json:"camera,omitempty"`
}

type alertCameraDetail struct {
	CameraID string `json:"cameraId"`
	Name     string `json:"name"`
}

type schoolDetailBridge struct {
	Online      bool    `json:"online"`
	LastPingAt  *string `json:"lastPingAt,omitempty"`
	InternalURL string  `json:"internalUrl"`
	PublicURL   *string `json:"publicUrl,omitempty"`
}

type schoolDetailResponse struct {
	ID                  string               `json:"id"`
	Name                string               `json:"name"`
	Slug                string               `json:"slug"`
	Address             *string              `json:"address,omitempty"`
	IPRange             *string              `json:"ipRange,omitempty"`
	CreatedAt           string               `json:"createdAt"`
	LocalStorageEnabled bool                 `json:"localStorageEnabled"`
	CloudStorageEnabled bool                 `json:"cloudStorageEnabled"`
	RemoteAccessEnabled bool                 `json:"remoteAccessEnabled"`
	LocalViewEnabled    bool                 `json:"localViewEnabled"`
	RetentionDays       int                  `json:"retentionDays"`
	MaxCameras          int                  `json:"maxCameras"`
	MaxUsers            int                  `json:"maxUsers"`
	Cameras             []schoolDetailCamera `json:"cameras"`
	Users               []schoolDetailUser   `json:"users"`
	Alerts              []schoolDetailAlert  `json:"alerts"`
	StreamBridge        *schoolDetailBridge  `json:"streamBridge"`
}

// GetSchool returns a single school with cameras, users, unresolved alerts,
// and stream bridge info. Requires canViewAllSchools permission.
func (h *Handlers) GetSchool(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if !permissions.HasPermission(user.Role, "canViewAllSchools") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Missing school id")
		return
	}

	ctx := r.Context()

	school, err := database.FindSchoolByID(ctx, id)
	if err != nil {
		log.Printf("[Schools] FindSchoolByID error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if school == nil {
		writeError(w, http.StatusNotFound, "School not found")
		return
	}

	// Cameras
	cameras, err := database.ListCamerasBySchool(ctx, id)
	if err != nil {
		log.Printf("[Schools] ListCamerasBySchool error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	detailCameras := make([]schoolDetailCamera, 0, len(cameras))
	for _, c := range cameras {
		dc := schoolDetailCamera{
			ID:         c.ID,
			CameraID:   c.CameraID,
			Name:       c.Name,
			Zone:       c.Zone,
			Type:       c.Type,
			Resolution: c.Resolution,
			Status:     string(c.Status),
		}
		if c.LastSeenAt != nil {
			ts := c.LastSeenAt.Format("2006-01-02T15:04:05.000Z")
			dc.LastSeenAt = &ts
		}
		detailCameras = append(detailCameras, dc)
	}

	// Users
	users, err := database.ListUsers(ctx, &id, nil, 1000, 0)
	if err != nil {
		log.Printf("[Schools] ListUsers error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	detailUsers := make([]schoolDetailUser, 0, len(users))
	for _, u := range users {
		detailUsers = append(detailUsers, schoolDetailUser{
			ID:     u.ID,
			Name:   u.Name,
			Email:  u.Email,
			Role:   string(u.Role),
			Active: u.Active,
		})
	}

	// Unresolved alerts (top 10)
	unresolvedFalse := false
	alerts, err := database.ListAlerts(ctx, database.AlertListParams{
		SchoolID: id,
		Resolved: &unresolvedFalse,
		Limit:    10,
		Offset:   0,
	})
	if err != nil {
		log.Printf("[Schools] ListAlerts error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	detailAlerts := make([]schoolDetailAlert, 0, len(alerts))
	for _, a := range alerts {
		da := schoolDetailAlert{
			ID:        a.ID,
			Type:      string(a.Type),
			Title:     a.Title,
			CreatedAt: a.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
		}
		// Resolve camera info for the alert if available.
		if a.CameraID != nil {
			cam, err := database.FindCameraByID(ctx, *a.CameraID)
			if err == nil && cam != nil {
				da.Camera = &alertCameraDetail{
					CameraID: cam.CameraID,
					Name:     cam.Name,
				}
			}
		}
		detailAlerts = append(detailAlerts, da)
	}

	// Stream bridge
	var detailBridge *schoolDetailBridge
	bridge, err := database.FindStreamBridgeBySchoolID(ctx, id)
	if err != nil {
		log.Printf("[Schools] Bridge lookup for %s: %v", id, err)
	}
	if bridge != nil {
		db := schoolDetailBridge{
			Online:      bridge.Online,
			InternalURL: bridge.InternalURL,
			PublicURL:   bridge.PublicURL,
		}
		if bridge.LastPingAt != nil {
			ts := bridge.LastPingAt.Format("2006-01-02T15:04:05.000Z")
			db.LastPingAt = &ts
		}
		detailBridge = &db
	}

	resp := schoolDetailResponse{
		ID:                  school.ID,
		Name:                school.Name,
		Slug:                school.Slug,
		Address:             school.Address,
		IPRange:             school.IPRange,
		CreatedAt:           school.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
		LocalStorageEnabled: school.LocalStorageEnabled,
		CloudStorageEnabled: school.CloudStorageEnabled,
		RemoteAccessEnabled: school.RemoteAccessEnabled,
		LocalViewEnabled:    school.LocalViewEnabled,
		RetentionDays:       school.RetentionDays,
		MaxCameras:          school.MaxCameras,
		MaxUsers:            school.MaxUsers,
		Cameras:             detailCameras,
		Users:               detailUsers,
		Alerts:              detailAlerts,
		StreamBridge:        detailBridge,
	}

	writeJSON(w, http.StatusOK, map[string]any{"school": resp})
}

// ─── PATCH /api/schools/{id}/settings ───────────────────

type schoolSettingsRequest struct {
	LocalStorageEnabled *bool `json:"localStorageEnabled,omitempty"`
	CloudStorageEnabled *bool `json:"cloudStorageEnabled,omitempty"`
	RemoteAccessEnabled *bool `json:"remoteAccessEnabled,omitempty"`
	LocalViewEnabled    *bool `json:"localViewEnabled,omitempty"`
	RetentionDays       *int  `json:"retentionDays,omitempty"`
	MaxCameras          *int  `json:"maxCameras,omitempty"`
	MaxUsers            *int  `json:"maxUsers,omitempty"`
}

type schoolSettingsResponse struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	LocalStorageEnabled bool   `json:"localStorageEnabled"`
	CloudStorageEnabled bool   `json:"cloudStorageEnabled"`
	RemoteAccessEnabled bool   `json:"remoteAccessEnabled"`
	LocalViewEnabled    bool   `json:"localViewEnabled"`
	RetentionDays       int    `json:"retentionDays"`
	MaxCameras          int    `json:"maxCameras"`
	MaxUsers            int    `json:"maxUsers"`
}

// UpdateSchoolSettings updates feature flags and limits for a school.
// Requires canEditFeatureFlags permission.
func (h *Handlers) UpdateSchoolSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if !permissions.HasPermission(user.Role, "canEditFeatureFlags") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Missing school id")
		return
	}

	ctx := r.Context()

	// Verify school exists.
	existing, err := database.FindSchoolByID(ctx, id)
	if err != nil {
		log.Printf("[Schools] FindSchoolByID error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "School not found")
		return
	}

	var body schoolSettingsRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	// Track whether any field was actually provided.
	hasUpdate := false

	// Apply provided fields with type validation.
	if body.LocalStorageEnabled != nil {
		existing.LocalStorageEnabled = *body.LocalStorageEnabled
		hasUpdate = true
	}
	if body.CloudStorageEnabled != nil {
		existing.CloudStorageEnabled = *body.CloudStorageEnabled
		hasUpdate = true
	}
	if body.RemoteAccessEnabled != nil {
		existing.RemoteAccessEnabled = *body.RemoteAccessEnabled
		hasUpdate = true
	}
	if body.LocalViewEnabled != nil {
		existing.LocalViewEnabled = *body.LocalViewEnabled
		hasUpdate = true
	}
	if body.RetentionDays != nil {
		if *body.RetentionDays < 1 {
			writeError(w, http.StatusBadRequest, "retentionDays must be a positive number")
			return
		}
		existing.RetentionDays = *body.RetentionDays
		hasUpdate = true
	}
	if body.MaxCameras != nil {
		if *body.MaxCameras < 1 {
			writeError(w, http.StatusBadRequest, "maxCameras must be a positive number")
			return
		}
		existing.MaxCameras = *body.MaxCameras
		hasUpdate = true
	}
	if body.MaxUsers != nil {
		if *body.MaxUsers < 1 {
			writeError(w, http.StatusBadRequest, "maxUsers must be a positive number")
			return
		}
		existing.MaxUsers = *body.MaxUsers
		hasUpdate = true
	}

	if !hasUpdate {
		writeError(w, http.StatusBadRequest, "No valid fields to update")
		return
	}

	if err := database.UpdateSchoolSettings(ctx, id, existing); err != nil {
		log.Printf("[Schools] UpdateSchoolSettings error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	// Invalidate feature flags cache.
	featureflags.InvalidateSchoolFlags(id)

	writeJSON(w, http.StatusOK, map[string]any{
		"school": schoolSettingsResponse{
			ID:                  existing.ID,
			Name:                existing.Name,
			LocalStorageEnabled: existing.LocalStorageEnabled,
			CloudStorageEnabled: existing.CloudStorageEnabled,
			RemoteAccessEnabled: existing.RemoteAccessEnabled,
			LocalViewEnabled:    existing.LocalViewEnabled,
			RetentionDays:       existing.RetentionDays,
			MaxCameras:          existing.MaxCameras,
			MaxUsers:            existing.MaxUsers,
		},
	})
}

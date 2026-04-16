package handlers

import (
	"log"
	"net/http"
	"strings"

	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/middleware"
	"safeguard-dashboard/internal/permissions"
)

// ─── Response Types ─────────────────────────────────────

// cameraResponse omits rtspUrl, matching the TypeScript select behavior.
type cameraResponse struct {
	ID         string  `json:"id"`
	CameraID   string  `json:"cameraId"`
	Name       string  `json:"name"`
	Zone       string  `json:"zone"`
	Type       string  `json:"type"`
	Resolution string  `json:"resolution"`
	Status     string  `json:"status"`
	LastSeenAt *string `json:"lastSeenAt,omitempty"`
	SchoolID   string  `json:"schoolId,omitempty"`
	CreatedAt  string  `json:"createdAt"`
}

func cameraToResponse(c *database.Camera) cameraResponse {
	resp := cameraResponse{
		ID:         c.ID,
		CameraID:   c.CameraID,
		Name:       c.Name,
		Zone:       c.Zone,
		Type:       c.Type,
		Resolution: c.Resolution,
		Status:     string(c.Status),
		SchoolID:   c.SchoolID,
		CreatedAt:  c.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
	}
	if c.LastSeenAt != nil {
		s := c.LastSeenAt.Format("2006-01-02T15:04:05.000Z")
		resp.LastSeenAt = &s
	}
	return resp
}

// ─── Handlers ───────────────────────────────────────────

// ListCameras handles GET /api/cameras.
// Returns cameras for the authenticated user's school (school-scoped).
// Ops users can pass ?schoolId to query any school. The rtspUrl field is
// never included in the response.
func (h *Handlers) ListCameras(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	querySchoolID := r.URL.Query().Get("schoolId")
	var schoolID string

	if permissions.IsOpsRole(user.Role) {
		if querySchoolID != "" {
			schoolID = querySchoolID
		}
	} else {
		schoolID = user.SchoolID
	}

	if schoolID == "" {
		writeError(w, http.StatusBadRequest, "No school context")
		return
	}

	if !permissions.IsOpsRole(user.Role) && schoolID != user.SchoolID {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	cameras, err := database.ListCamerasBySchool(r.Context(), schoolID)
	if err != nil {
		log.Printf("[Cameras] List error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	result := make([]cameraResponse, 0, len(cameras))
	for i := range cameras {
		resp := cameraToResponse(&cameras[i])
		resp.SchoolID = "" // Omit schoolId in list response (matches TS select)
		result = append(result, resp)
	}

	writeJSON(w, http.StatusOK, map[string]any{"cameras": result})
}

// GetCamera handles GET /api/cameras/{id}.
// Returns a single camera by its database ID. School-scoped access check is
// applied: school users can only see cameras belonging to their school.
func (h *Handlers) GetCamera(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	// Extract camera ID from URL path: /api/cameras/{id}
	id := extractPathParam(r.URL.Path, "/api/cameras/")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Missing camera ID")
		return
	}

	camera, err := database.FindCameraByID(r.Context(), id)
	if err != nil {
		log.Printf("[Cameras] Get error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if camera == nil {
		writeError(w, http.StatusNotFound, "Camera not found")
		return
	}

	// School-scoped access check.
	if !permissions.IsOpsRole(user.Role) && camera.SchoolID != user.SchoolID {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"camera": cameraToResponse(camera)})
}

// extractPathParam extracts the trailing segment after a prefix from a URL path.
// e.g., extractPathParam("/api/cameras/abc123", "/api/cameras/") returns "abc123".
func extractPathParam(path, prefix string) string {
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	param := strings.TrimPrefix(path, prefix)
	// Strip trailing slash if present.
	param = strings.TrimSuffix(param, "/")
	// If there are additional path segments, only take the first.
	if idx := strings.Index(param, "/"); idx >= 0 {
		param = param[:idx]
	}
	return param
}

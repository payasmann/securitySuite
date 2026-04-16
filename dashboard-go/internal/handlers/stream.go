package handlers

import (
	"fmt"
	"log"
	"net/http"

	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/middleware"
	"safeguard-dashboard/internal/permissions"
)

// ─── Response Types ─────────────────────────────────────

type streamLegacy struct {
	URL      string `json:"url"`
	CameraID string `json:"cameraId"`
	Name     string `json:"name"`
	Status   string `json:"status"`
}

type streamResponse struct {
	WHEPUrl          string        `json:"whepUrl,omitempty"`
	DirectConnection bool          `json:"directConnection"`
	ICEServers       []interface{} `json:"iceServers"`
	AudioEnabled     bool          `json:"audioEnabled"`
	Stream           *streamLegacy `json:"stream,omitempty"`
	RemoteBlocked    bool          `json:"remoteBlocked"`
}

// ─── GET /api/stream/{cameraId} ─────────────────────────

// GetStream returns the WHEP stream URL for a camera. Checks authentication,
// canViewLiveFeeds permission, school-scoped access, feature flags, and
// bridge/camera online status.
func (h *Handlers) GetStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	if !permissions.HasPermission(user.Role, "canViewLiveFeeds") {
		writeError(w, http.StatusForbidden, "Your role does not have access to live feeds")
		return
	}

	cameraID := r.PathValue("cameraId")
	if cameraID == "" {
		writeError(w, http.StatusBadRequest, "Missing cameraId")
		return
	}

	ctx := r.Context()

	// Find camera by database ID.
	camera, err := database.FindCameraByID(ctx, cameraID)
	if err != nil {
		log.Printf("[Stream] FindCameraByID error: %v", err)
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

	// Load school to check feature flags.
	school, err := database.FindSchoolByID(ctx, camera.SchoolID)
	if err != nil {
		log.Printf("[Stream] FindSchoolByID error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if school == nil {
		writeError(w, http.StatusNotFound, "School not found")
		return
	}

	// Check localViewEnabled.
	if !school.LocalViewEnabled {
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "Live viewing is disabled for this school",
			"code":  "LOCAL_VIEW_DISABLED",
		})
		return
	}

	// Check remoteAccessEnabled.
	if !school.RemoteAccessEnabled {
		writeJSON(w, http.StatusOK, map[string]any{
			"stream":        nil,
			"remoteBlocked": true,
			"message":       "On-premises access only. Connect to the school network to view live feeds.",
		})
		return
	}

	// Check stream bridge.
	bridge, err := database.FindStreamBridgeBySchoolID(ctx, camera.SchoolID)
	if err != nil {
		log.Printf("[Stream] FindStreamBridge error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if bridge == nil || !bridge.Online {
		writeJSON(w, http.StatusOK, map[string]any{
			"stream":        nil,
			"bridgeOffline": true,
			"message":       "Stream bridge is offline. Contact your administrator.",
		})
		return
	}

	// Check camera online status.
	if camera.Status == database.CameraStatusOffline {
		writeJSON(w, http.StatusOK, map[string]any{
			"stream":        nil,
			"cameraOffline": true,
			"message":       "Camera is currently offline.",
		})
		return
	}

	// Build WHEP URL.
	// Prefer publicUrl for direct agent-to-browser WebRTC (bypasses cloud server).
	// Fall back to internalUrl if agent hasn't reported a public URL.
	directConnection := bridge.PublicURL != nil && *bridge.PublicURL != ""
	baseURL := bridge.InternalURL
	if directConnection {
		baseURL = *bridge.PublicURL
	}

	if !directConnection {
		log.Printf("[Stream] Camera %s: falling back to internal URL (agent publicUrl not configured)",
			camera.CameraID)
	}

	whepURL := fmt.Sprintf("%s/%s/whep", baseURL, camera.CameraID)

	writeJSON(w, http.StatusOK, streamResponse{
		WHEPUrl:          whepURL,
		DirectConnection: directConnection,
		ICEServers:       []interface{}{},
		AudioEnabled:     true,
		Stream: &streamLegacy{
			URL:      whepURL,
			CameraID: camera.CameraID,
			Name:     camera.Name,
			Status:   string(camera.Status),
		},
		RemoteBlocked: false,
	})
}

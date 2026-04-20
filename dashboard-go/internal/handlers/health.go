package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"safeguard-dashboard/internal/auth"
	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/websocket"
)

// ─── Request / Response Types ───────────────────────────

type healthCameraPayload struct {
	CameraID      string `json:"cameraId"`
	Status        string `json:"status"` // "ONLINE" | "OFFLINE" | "WARNING"
	RtspReachable bool   `json:"rtspReachable"`
}

type healthRecordingPayload struct {
	ActiveRecordings int      `json:"activeRecordings"`
	RecordingCameras []string `json:"recordingCameras"`
	DiskUsageGB      float64  `json:"diskUsageGB"`
}

type healthRequest struct {
	SchoolID     string                  `json:"schoolId"`
	APIKey       string                  `json:"apiKey"`
	Cameras      []healthCameraPayload   `json:"cameras"`
	BridgeOnline bool                    `json:"bridgeOnline"`
	Timestamp    string                  `json:"timestamp"`
	PublicURL    *string                 `json:"publicUrl,omitempty"`
	Recording    *healthRecordingPayload `json:"recording,omitempty"`
}

type healthResponse struct {
	Status        string `json:"status"`
	Processed     int    `json:"processed"`
	StaleDetected int    `json:"staleDetected"`
	Timestamp     string `json:"timestamp"`
}

// ─── Handler ────────────────────────────────────────────

// Health handles POST /api/health and POST /api/v1/health.
// Agent heartbeat endpoint: validates credentials, updates bridge and camera
// statuses, detects stale cameras, creates alerts, and emits websocket events.
func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var body healthRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	if body.SchoolID == "" || body.APIKey == "" {
		writeError(w, http.StatusBadRequest, "Missing schoolId or apiKey")
		return
	}

	ctx := r.Context()

	// Find the stream bridge for this school.
	bridge, err := database.FindStreamBridgeBySchoolID(ctx, body.SchoolID)
	if err != nil {
		log.Printf("[Health] DB error finding bridge: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if bridge == nil {
		writeError(w, http.StatusNotFound, "Stream bridge not found for this school")
		return
	}

	// Verify API key with bcrypt.
	if !auth.ComparePassword(bridge.APIKey, body.APIKey) {
		writeError(w, http.StatusUnauthorized, "Invalid API key")
		return
	}

	now := time.Now().UTC()

	// Build bridge update fields.
	publicURL := bridge.PublicURL
	if body.PublicURL != nil && *body.PublicURL != "" {
		publicURL = body.PublicURL
	}

	// Update bridge status.
	if err := database.UpdateStreamBridge(ctx, bridge.ID, bridge.InternalURL, publicURL, body.BridgeOnline, &now); err != nil {
		log.Printf("[Health] Failed to update bridge: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	// Log publicUrl changes.
	if body.PublicURL != nil && *body.PublicURL != "" {
		oldURL := "(none)"
		if bridge.PublicURL != nil {
			oldURL = *bridge.PublicURL
		}
		if *body.PublicURL != oldURL {
			log.Printf("[Health] Agent publicUrl updated for school %s: %s → %s",
				body.SchoolID, oldURL, *body.PublicURL)
		}
	}

	// Log recording status from agent.
	if body.Recording != nil {
		log.Printf("[Health] Recording: %d cameras, %.1f GB used",
			body.Recording.ActiveRecordings, body.Recording.DiskUsageGB)
	}

	// Emit bridge status websocket event.
	websocket.EmitBridgeStatus(h.Hub, websocket.BridgeStatusPayload{
		SchoolID:   body.SchoolID,
		Online:     body.BridgeOnline,
		LastPingAt: now.Format(time.RFC3339),
	})

	// ── Process camera statuses ─────────────────────────
	processed := 0
	if len(body.Cameras) > 0 {
		for _, cam := range body.Cameras {
			if err := h.processHealthCamera(ctx, body.SchoolID, cam, now); err != nil {
				log.Printf("[Health] Error processing camera %s: %v", cam.CameraID, err)
			}
			processed++
		}
	}

	// ── Detect stale cameras ────────────────────────────
	staleDetected, err := h.detectStaleCameras(ctx, body.SchoolID, now)
	if err != nil {
		log.Printf("[Health] Error detecting stale cameras: %v", err)
	}

	writeJSON(w, http.StatusOK, healthResponse{
		Status:        "ok",
		Processed:     processed,
		StaleDetected: staleDetected,
		Timestamp:     now.Format(time.RFC3339),
	})
}

// processHealthCamera updates a single camera's status and creates alerts
// for offline/recovery transitions.
func (h *Handlers) processHealthCamera(ctx context.Context, schoolID string, cam healthCameraPayload, now time.Time) error {
	// Map agent status to DB status.
	dbStatus := database.CameraStatus(cam.Status)
	if !cam.RtspReachable && cam.Status == "ONLINE" {
		dbStatus = database.CameraStatusWarning
	}

	// Find camera by schoolId + display cameraId.
	existing, err := database.FindCameraBySchoolAndCameraID(ctx, schoolID, cam.CameraID)
	if err != nil {
		return fmt.Errorf("find camera: %w", err)
	}
	if existing == nil {
		return nil // Camera not registered in DB; skip.
	}

	previousStatus := existing.Status

	// Update camera status and lastSeenAt.
	var lastSeenAt *time.Time
	if dbStatus != database.CameraStatusOffline {
		lastSeenAt = &now
	}
	if err := database.UpdateCameraStatus(ctx, existing.ID, dbStatus, lastSeenAt); err != nil {
		return fmt.Errorf("update camera status: %w", err)
	}

	// Emit camera status change websocket event.
	websocket.EmitCameraStatus(h.Hub, websocket.CameraStatusPayload{
		CameraID:         cam.CameraID,
		CameraDatabaseID: existing.ID,
		Status:           string(dbStatus),
		SchoolID:         schoolID,
	})

	// Generate CRITICAL alert if camera went offline.
	if previousStatus != database.CameraStatusOffline && dbStatus == database.CameraStatusOffline {
		detail := fmt.Sprintf("%s has gone offline", cam.CameraID)
		alert := &database.Alert{
			Type:     database.AlertTypeCritical,
			Title:    "Camera offline",
			Detail:   &detail,
			CameraID: &existing.ID,
			SchoolID: schoolID,
		}
		created, err := database.CreateAlert(ctx, alert)
		if err != nil {
			log.Printf("[Health] Failed to create offline alert for %s: %v", cam.CameraID, err)
		} else {
			websocket.EmitAlert(h.Hub, websocket.AlertPayload{
				ID:        created.ID,
				Type:      string(created.Type),
				Title:     created.Title,
				Detail:    created.Detail,
				CameraID:  created.CameraID,
				SchoolID:  created.SchoolID,
				CreatedAt: created.CreatedAt.Format(time.RFC3339),
			})
		}
	}

	// Generate INFO alert if camera recovered from offline.
	if previousStatus == database.CameraStatusOffline && dbStatus == database.CameraStatusOnline {
		detail := fmt.Sprintf("%s has recovered", cam.CameraID)
		alert := &database.Alert{
			Type:     database.AlertTypeInfo,
			Title:    "Camera back online",
			Detail:   &detail,
			CameraID: &existing.ID,
			SchoolID: schoolID,
		}
		created, err := database.CreateAlert(ctx, alert)
		if err != nil {
			log.Printf("[Health] Failed to create recovery alert for %s: %v", cam.CameraID, err)
		} else {
			websocket.EmitAlert(h.Hub, websocket.AlertPayload{
				ID:        created.ID,
				Type:      string(created.Type),
				Title:     created.Title,
				Detail:    created.Detail,
				CameraID:  created.CameraID,
				SchoolID:  created.SchoolID,
				CreatedAt: created.CreatedAt.Format(time.RFC3339),
			})
		}
	}

	return nil
}

// detectStaleCameras finds cameras that missed heartbeats (>90s since
// lastSeenAt, not already OFFLINE), marks them offline, and creates alerts.
func (h *Handlers) detectStaleCameras(ctx context.Context, schoolID string, now time.Time) (int, error) {
	staleThreshold := now.Add(-90 * time.Second)

	// Query stale cameras for this school.
	const q = `
		SELECT id, camera_id, status
		FROM "Camera"
		WHERE school_id = $1
		  AND status != 'OFFLINE'
		  AND (last_seen_at IS NULL OR last_seen_at < $2)`

	rows, err := h.Pool.Query(ctx, q, schoolID, staleThreshold)
	if err != nil {
		return 0, fmt.Errorf("query stale cameras: %w", err)
	}
	defer rows.Close()

	type staleCamera struct {
		ID       string
		CameraID string
		Status   string
	}

	var staleCameras []staleCamera
	for rows.Next() {
		var sc staleCamera
		if err := rows.Scan(&sc.ID, &sc.CameraID, &sc.Status); err != nil {
			return 0, fmt.Errorf("scan stale camera: %w", err)
		}
		staleCameras = append(staleCameras, sc)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate stale cameras: %w", err)
	}

	for _, sc := range staleCameras {
		// Mark camera as offline.
		if err := database.UpdateCameraStatus(ctx, sc.ID, database.CameraStatusOffline, nil); err != nil {
			log.Printf("[Health] Failed to mark stale camera %s offline: %v", sc.CameraID, err)
			continue
		}

		// Emit camera status change.
		websocket.EmitCameraStatus(h.Hub, websocket.CameraStatusPayload{
			CameraID:         sc.CameraID,
			CameraDatabaseID: sc.ID,
			Status:           string(database.CameraStatusOffline),
			SchoolID:         schoolID,
		})

		// Create CRITICAL alert.
		detail := fmt.Sprintf("%s missed 3 consecutive heartbeats", sc.CameraID)
		alert := &database.Alert{
			Type:     database.AlertTypeCritical,
			Title:    "Camera offline (missed heartbeats)",
			Detail:   &detail,
			CameraID: &sc.ID,
			SchoolID: schoolID,
		}
		created, err := database.CreateAlert(ctx, alert)
		if err != nil {
			log.Printf("[Health] Failed to create stale alert for %s: %v", sc.CameraID, err)
			continue
		}

		websocket.EmitAlert(h.Hub, websocket.AlertPayload{
			ID:        created.ID,
			Type:      string(created.Type),
			Title:     created.Title,
			Detail:    created.Detail,
			CameraID:  created.CameraID,
			SchoolID:  created.SchoolID,
			CreatedAt: created.CreatedAt.Format(time.RFC3339),
		})
	}

	return len(staleCameras), nil
}

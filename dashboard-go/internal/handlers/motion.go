package handlers

import (
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"safeguard-dashboard/internal/auth"
	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/websocket"
)

// ─── Rate Tracking ──────────────────────────────────────

const (
	rateWindowMS       = 60_000 // 60 seconds
	rateAlertThreshold = 5      // events within window before alert
)

// motionRateTracker provides in-memory per-camera rate tracking for motion
// events. It is safe for concurrent use.
type motionRateTracker struct {
	mu     sync.Mutex
	events map[string][]int64 // cameraDatabaseId -> list of unix millisecond timestamps
}

var rateTracker = &motionRateTracker{
	events: make(map[string][]int64),
}

// record adds a timestamp for a camera and returns (count, exceeded).
// If the threshold is exceeded, the tracker resets the counter and returns
// exceeded=true so the caller can create a warning alert once.
func (rt *motionRateTracker) record(cameraID string, nowMs int64) (int, bool) {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	timestamps := rt.events[cameraID]

	// Prune old timestamps outside the window.
	cutoff := nowMs - rateWindowMS
	start := 0
	for start < len(timestamps) && timestamps[start] < cutoff {
		start++
	}
	timestamps = append(timestamps[start:], nowMs)
	rt.events[cameraID] = timestamps

	if len(timestamps) >= rateAlertThreshold {
		count := len(timestamps)
		// Reset so we don't spam alerts every subsequent event.
		rt.events[cameraID] = nil
		return count, true
	}

	return len(timestamps), false
}

// ─── Request / Response Types ───────────────────────────

type motionRequest struct {
	CameraID   string   `json:"cameraId"`
	SchoolID   string   `json:"schoolId"`
	Timestamp  string   `json:"timestamp"`
	Confidence *float64 `json:"confidence,omitempty"`
}

type motionResponse struct {
	Status    string `json:"status"`
	EventID   string `json:"eventId"`
	Timestamp string `json:"timestamp"`
}

// ─── Handler ────────────────────────────────────────────

// Motion handles POST /api/motion and POST /api/v1/motion.
// Receives motion events from on-premises agents authenticated via
// the school's StreamBridge API key in headers.
func (h *Handlers) Motion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Authenticate via headers.
	schoolIDHeader := r.Header.Get("X-School-ID")
	apiKey := r.Header.Get("X-API-Key")

	if schoolIDHeader == "" || apiKey == "" {
		writeError(w, http.StatusBadRequest, "Missing X-School-ID or X-API-Key header")
		return
	}

	var body motionRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	if body.CameraID == "" || body.SchoolID == "" {
		writeError(w, http.StatusBadRequest, "Missing cameraId or schoolId in body")
		return
	}

	// Verify schoolId in header matches body.
	if schoolIDHeader != body.SchoolID {
		writeError(w, http.StatusBadRequest, "School ID mismatch between header and body")
		return
	}

	ctx := r.Context()

	// Find the stream bridge for authentication.
	bridge, err := database.FindStreamBridgeBySchoolID(ctx, schoolIDHeader)
	if err != nil {
		log.Printf("[Motion] DB error finding bridge: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if bridge == nil {
		writeError(w, http.StatusNotFound, "Stream bridge not found for this school")
		return
	}

	// Verify API key (bcrypt compare).
	if !auth.ComparePassword(bridge.APIKey, apiKey) {
		writeError(w, http.StatusUnauthorized, "Invalid API key")
		return
	}

	// Look up camera by display cameraId within this school.
	camera, err := database.FindCameraBySchoolAndCameraID(ctx, schoolIDHeader, body.CameraID)
	if err != nil {
		log.Printf("[Motion] DB error finding camera: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if camera == nil {
		writeError(w, http.StatusNotFound,
			fmt.Sprintf("Camera %s not found for school %s", body.CameraID, schoolIDHeader))
		return
	}

	// Parse timestamp or use current time.
	recordedAt := time.Now().UTC()
	if body.Timestamp != "" {
		if parsed, err := time.Parse(time.RFC3339, body.Timestamp); err == nil {
			recordedAt = parsed
		}
	}

	// Create MotionEvent record.
	motionEvent := &database.MotionEvent{
		CameraID:   camera.ID, // database cuid
		SchoolID:   schoolIDHeader,
		RecordedAt: recordedAt,
	}
	created, err := database.CreateMotionEvent(ctx, motionEvent)
	if err != nil {
		log.Printf("[Motion] Failed to create motion event: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	// Emit real-time websocket event.
	websocket.EmitMotionDetected(h.Hub, websocket.MotionDetectedPayload{
		CameraID:         body.CameraID,
		CameraDatabaseID: camera.ID,
		CameraName:       camera.Name,
		Zone:             camera.Zone,
		SchoolID:         schoolIDHeader,
		Timestamp:        created.RecordedAt.Format(time.RFC3339),
	})

	// Rate-limit tracking: auto-create WARNING alert if too many events.
	nowMs := time.Now().UnixMilli()
	count, exceeded := rateTracker.record(camera.ID, nowMs)
	if exceeded {
		detail := fmt.Sprintf("Camera %s reported %d motion events in the last 60 seconds",
			body.CameraID, count)
		alert := &database.Alert{
			Type:     database.AlertTypeWarning,
			Title:    "Excessive motion detected",
			Detail:   &detail,
			CameraID: &camera.ID,
			SchoolID: schoolIDHeader,
		}
		alertCreated, err := database.CreateAlert(ctx, alert)
		if err != nil {
			log.Printf("[Motion] Failed to create rate-limit alert: %v", err)
		} else {
			websocket.EmitAlert(h.Hub, websocket.AlertPayload{
				ID:        alertCreated.ID,
				Type:      string(alertCreated.Type),
				Title:     alertCreated.Title,
				Detail:    alertCreated.Detail,
				CameraID:  alertCreated.CameraID,
				SchoolID:  alertCreated.SchoolID,
				CreatedAt: alertCreated.CreatedAt.Format(time.RFC3339),
			})
		}
	}

	writeJSON(w, http.StatusOK, motionResponse{
		Status:    "ok",
		EventID:   created.ID,
		Timestamp: created.RecordedAt.Format(time.RFC3339),
	})
}

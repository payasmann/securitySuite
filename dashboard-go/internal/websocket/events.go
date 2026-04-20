package websocket

import (
	"encoding/json"
	"fmt"
	"log"
)

// ─── Event Type Constants ───────────────────────────────

const (
	EventAlertNew           = "alert:new"
	EventCameraStatusChange = "camera:statusChange"
	EventDashboardUpdate    = "dashboard:update"
	EventBridgeStatus       = "bridge:status"
	EventMotionDetected     = "motion:detected"
)

// ─── Payload Structs ────────────────────────────────────

// AlertPayload is the data sent with an alert:new event.
type AlertPayload struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"`
	Title     string  `json:"title"`
	Detail    *string `json:"detail"`
	CameraID  *string `json:"cameraId"`
	SchoolID  string  `json:"schoolId"`
	CreatedAt string  `json:"createdAt"`
}

// CameraStatusPayload is the data sent with a camera:statusChange event.
type CameraStatusPayload struct {
	CameraID         string `json:"cameraId"`
	CameraDatabaseID string `json:"cameraDatabaseId"`
	Status           string `json:"status"` // "ONLINE" | "OFFLINE" | "WARNING"
	SchoolID         string `json:"schoolId"`
}

// DashboardStats holds the aggregate stats embedded in DashboardUpdatePayload.
type DashboardStats struct {
	CamerasOnline int `json:"camerasOnline"`
	CamerasTotal  int `json:"camerasTotal"`
	ActiveAlerts  int `json:"activeAlerts"`
	MotionEvents  int `json:"motionEvents"`
}

// DashboardUpdatePayload is the data sent with a dashboard:update event.
type DashboardUpdatePayload struct {
	SchoolID string         `json:"schoolId"`
	Stats    DashboardStats `json:"stats"`
}

// BridgeStatusPayload is the data sent with a bridge:status event.
type BridgeStatusPayload struct {
	SchoolID   string `json:"schoolId"`
	Online     bool   `json:"online"`
	LastPingAt string `json:"lastPingAt"`
}

// MotionDetectedPayload is the data sent with a motion:detected event.
type MotionDetectedPayload struct {
	CameraID         string `json:"cameraId"`
	CameraDatabaseID string `json:"cameraDatabaseId"`
	CameraName       string `json:"cameraName"`
	Zone             string `json:"zone"`
	SchoolID         string `json:"schoolId"`
	Timestamp        string `json:"timestamp"`
}

// ─── Internal Helpers ───────────────────────────────────

// marshalEvent serialises an OutgoingMessage to JSON.
func marshalEvent(event string, data interface{}) ([]byte, error) {
	msg := OutgoingMessage{
		Event: event,
		Data:  data,
	}
	return json.Marshal(msg)
}

// emitToRooms sends a JSON-encoded event to the specified school room and the
// ops room. If marshalling fails, the error is logged and the emit is skipped.
func emitToRooms(hub *Hub, schoolID string, event string, data interface{}) {
	payload, err := marshalEvent(event, data)
	if err != nil {
		log.Printf("[WS] Failed to marshal %s event: %v", event, err)
		return
	}

	hub.BroadcastToRoom(fmt.Sprintf("school:%s", schoolID), payload)
	hub.BroadcastToRoom("ops", payload)
}

// emitToSchoolOnly sends a JSON-encoded event only to the school room (no ops).
func emitToSchoolOnly(hub *Hub, schoolID string, event string, data interface{}) {
	payload, err := marshalEvent(event, data)
	if err != nil {
		log.Printf("[WS] Failed to marshal %s event: %v", event, err)
		return
	}

	hub.BroadcastToRoom(fmt.Sprintf("school:%s", schoolID), payload)
}

// ─── Emit Functions ─────────────────────────────────────

// EmitAlert broadcasts an alert:new event to the school room and the ops room.
func EmitAlert(hub *Hub, alert AlertPayload) {
	emitToRooms(hub, alert.SchoolID, EventAlertNew, alert)
}

// EmitCameraStatus broadcasts a camera:statusChange event to the school room
// and the ops room.
func EmitCameraStatus(hub *Hub, data CameraStatusPayload) {
	emitToRooms(hub, data.SchoolID, EventCameraStatusChange, data)
}

// EmitDashboardUpdate broadcasts a dashboard:update event to the school room
// and the ops room.
func EmitDashboardUpdate(hub *Hub, data DashboardUpdatePayload) {
	emitToRooms(hub, data.SchoolID, EventDashboardUpdate, data)
}

// EmitBridgeStatus broadcasts a bridge:status event to the school room and the
// ops room.
func EmitBridgeStatus(hub *Hub, data BridgeStatusPayload) {
	emitToRooms(hub, data.SchoolID, EventBridgeStatus, data)
}

// EmitMotionDetected broadcasts a motion:detected event to the school room and
// the ops room.
func EmitMotionDetected(hub *Hub, data MotionDetectedPayload) {
	emitToRooms(hub, data.SchoolID, EventMotionDetected, data)
}

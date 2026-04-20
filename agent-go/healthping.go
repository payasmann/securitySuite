package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/url"
	"sync"
	"time"
)

// cameraStatus represents the status of a single camera in the heartbeat payload.
type cameraStatus struct {
	CameraID      string `json:"cameraId"`
	Status        string `json:"status"`
	RtspReachable bool   `json:"rtspReachable"`
}

// heartbeatPayload is the JSON body sent to the cloud API.
type heartbeatPayload struct {
	SchoolID     string         `json:"schoolId"`
	APIKey       string         `json:"apiKey"`
	Cameras      []cameraStatus `json:"cameras"`
	BridgeOnline bool           `json:"bridgeOnline"`
	Timestamp    string         `json:"timestamp"`
	Recording    *recordingInfo `json:"recording,omitempty"`
	PublicURL    string         `json:"publicUrl,omitempty"`
}

type recordingInfo struct {
	ActiveRecordings int      `json:"activeRecordings"`
	RecordingCameras []string `json:"recordingCameras"`
	DiskUsageGB      float64  `json:"diskUsageGB"`
}

// heartbeatResponse is the expected JSON response from the cloud API.
type heartbeatResponse struct {
	Processed     int    `json:"processed"`
	StaleDetected int    `json:"staleDetected"`
	Error         string `json:"error,omitempty"`
}

var (
	cameraStates   = make(map[string]bool)
	cameraStatesMu sync.RWMutex
)

// checkRtspReachable performs a TCP connection check to the RTSP port.
func checkRtspReachable(rtspURL string) bool {
	parsed, err := url.Parse(rtspURL)
	if err != nil {
		return false
	}

	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = "554"
	}

	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 3*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// sendHeartbeat checks camera reachability and sends a heartbeat to the cloud API.
func sendHeartbeat(cfg *AgentConfig) error {
	var statuses []cameraStatus

	for _, cam := range cfg.Cameras {
		reachable := checkRtspReachable(cam.RtspURL)

		cameraStatesMu.Lock()
		wasReachable, known := cameraStates[cam.CameraID]
		cameraStates[cam.CameraID] = reachable
		cameraStatesMu.Unlock()

		// Log status changes
		if known && wasReachable != reachable {
			if reachable {
				fmt.Printf("[Health] %s RECOVERED\n", cam.CameraID)
			} else {
				fmt.Printf("[Health] %s UNREACHABLE\n", cam.CameraID)
			}
		}

		status := "ONLINE"
		if !reachable {
			status = "OFFLINE"
		}

		statuses = append(statuses, cameraStatus{
			CameraID:      cam.CameraID,
			Status:        status,
			RtspReachable: reachable,
		})
	}

	// Gather recording status
	recStatus := GetRecordingStatus()
	diskUsage := GetDiskUsageGB()

	payload := heartbeatPayload{
		SchoolID:     cfg.SchoolID,
		APIKey:       cfg.APIKey,
		Cameras:      statuses,
		BridgeOnline: true,
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		Recording: &recordingInfo{
			ActiveRecordings: recStatus.ActiveRecordings,
			RecordingCameras: recStatus.Cameras,
			DiskUsageGB:      diskUsage,
		},
	}

	if cfg.AgentPublicURL != "" {
		payload.PublicURL = cfg.AgentPublicURL
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal heartbeat: %w", err)
	}

	resp, err := httpClient.Post(cfg.APIUrl+"/api/v1/health", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("network error: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errResp heartbeatResponse
		json.Unmarshal(respBody, &errResp)
		errMsg := errResp.Error
		if errMsg == "" {
			errMsg = "Unknown error"
		}
		return fmt.Errorf("heartbeat failed (%d): %s", resp.StatusCode, errMsg)
	}

	var data heartbeatResponse
	if err := json.Unmarshal(respBody, &data); err == nil {
		fmt.Printf("[Health] Heartbeat OK — %d cameras, %d stale\n", data.Processed, data.StaleDetected)
	}

	return nil
}

// StartHealthPing starts the periodic heartbeat to the cloud API.
func StartHealthPing(cfg *AgentConfig) {
	interval := time.Duration(cfg.HeartbeatInterval) * time.Millisecond
	fmt.Printf("[Health] Starting heartbeat every %dms\n", cfg.HeartbeatInterval)

	// Initial ping
	if err := sendHeartbeat(cfg); err != nil {
		fmt.Printf("[Health] %s\n", err)
	}

	// Recurring ping
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		consecutiveFailures := 0

		for range ticker.C {
			if err := sendHeartbeat(cfg); err != nil {
				consecutiveFailures++
				backoff := time.Duration(cfg.HeartbeatInterval) * time.Millisecond * time.Duration(1<<uint(consecutiveFailures))
				if backoff > 5*time.Minute {
					backoff = 5 * time.Minute
				}
				fmt.Printf("[Health] %s — retry in %v (failure #%d)\n", err, backoff, consecutiveFailures)
			} else {
				consecutiveFailures = 0
			}
		}
	}()
}

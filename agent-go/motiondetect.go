package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"safeguard-agent/onvif"
)

// ONVIF motion-related topics we listen for.
var motionTopics = []string{
	"RuleEngine/CellMotionDetector/Motion",
	"RuleEngine/MotionRegionDetector/Motion",
	"VideoAnalytics/Motion",
	"VideoSource/MotionAlarm",
	"Device/Trigger/DigitalInput",
}

const motionDebounceMS = 10_000

var (
	lastMotionTimestamps   = make(map[string]time.Time)
	lastMotionTimestampsMu sync.Mutex
	motionStopped          bool
	motionStoppedMu        sync.RWMutex
	activeSubscriptions    []*onvif.EventSubscription
	activeSubscriptionsMu  sync.Mutex
)

// isMotionTopic checks if an ONVIF event topic is motion-related.
func isMotionTopic(topic string) bool {
	if topic == "" {
		return false
	}
	for _, t := range motionTopics {
		if strings.Contains(topic, t) {
			return true
		}
	}
	return false
}

// shouldReportMotion debounce check — returns true if enough time has passed.
func shouldReportMotion(cameraID string) bool {
	lastMotionTimestampsMu.Lock()
	defer lastMotionTimestampsMu.Unlock()

	now := time.Now()
	if last, ok := lastMotionTimestamps[cameraID]; ok {
		if now.Sub(last) < time.Duration(motionDebounceMS)*time.Millisecond {
			return false
		}
	}
	lastMotionTimestamps[cameraID] = now
	return true
}

// reportMotion POSTs a motion event to the cloud API.
func reportMotion(cfg *AgentConfig, cameraID string) {
	payload := map[string]string{
		"cameraId":  cameraID,
		"schoolId":  cfg.SchoolID,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		fmt.Printf("[Motion] Failed to marshal motion event: %s\n", err)
		return
	}

	reqURL := cfg.APIUrl + "/api/v1/motion"
	req, err := http.NewRequest("POST", reqURL, bytes.NewReader(body))
	if err != nil {
		fmt.Printf("[Motion] Failed to create request: %s\n", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-School-ID", cfg.SchoolID)
	req.Header.Set("X-API-Key", cfg.APIKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		fmt.Printf("[Motion] Failed to report motion for %s: %s\n", cameraID, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		fmt.Printf("[Motion] Cloud API responded %d: %s\n", resp.StatusCode, string(respBody))
	}
}

// extractHostFromRtsp extracts the hostname from an RTSP URL.
func extractHostFromRtsp(rtspURL string) string {
	// Replace rtsp:// with http:// so URL parser works
	httpURL := strings.Replace(rtspURL, "rtsp://", "http://", 1)
	parsed, err := url.Parse(httpURL)
	if err != nil {
		return ""
	}
	return parsed.Hostname()
}

// handleONVIFEvent processes a raw ONVIF notification message for a camera.
func handleONVIFEvent(cfg *AgentConfig, cameraID string, data []byte) {
	motionStoppedMu.RLock()
	if motionStopped {
		motionStoppedMu.RUnlock()
		return
	}
	motionStoppedMu.RUnlock()

	// Parse the ONVIF notification envelope
	var env onvif.NotificationEnvelope
	if err := xml.Unmarshal(data, &env); err != nil {
		// Try a simpler string-based approach
		content := string(data)
		for _, topic := range motionTopics {
			if strings.Contains(content, topic) {
				// Check for false/0 values indicating motion stopped
				if strings.Contains(content, ">false<") || strings.Contains(content, ">0<") {
					return
				}
				if shouldReportMotion(cameraID) {
					fmt.Printf("[Motion] %s: motion detected (%s)\n", cameraID, topic)
					go reportMotion(cfg, cameraID)
				}
				return
			}
		}
		return
	}

	// Check if any notification message has a motion topic
	for _, msg := range env.Messages {
		topic := msg.Topic.Value
		if topic == "" {
			continue
		}

		if !isMotionTopic(topic) {
			continue
		}

		// Check for false values indicating motion stopped
		for _, item := range msg.Data.SimpleItems {
			val := strings.ToLower(item.Value)
			if val == "false" || val == "0" {
				return
			}
		}

		if shouldReportMotion(cameraID) {
			fmt.Printf("[Motion] %s: motion detected (%s)\n", cameraID, topic)
			go reportMotion(cfg, cameraID)
		}
		return
	}
}

// StartMotionDetect starts ONVIF motion detection for all configured cameras.
func StartMotionDetect(cfg *AgentConfig) {
	motionStoppedMu.Lock()
	motionStopped = false
	motionStoppedMu.Unlock()

	fmt.Println("[Motion] Motion detection listener started")
	fmt.Printf("[Motion] Monitoring %d cameras\n", len(cfg.Cameras))

	for _, camera := range cfg.Cameras {
		cam := camera // capture loop variable

		if cam.OnvifUser == "" || cam.OnvifPassword == "" {
			fmt.Printf("[Motion] %s: no ONVIF credentials, skipping ONVIF subscription\n", cam.CameraID)
			continue
		}

		hostname := extractHostFromRtsp(cam.RtspURL)
		if hostname == "" {
			fmt.Printf("[Motion] %s: could not parse hostname from RTSP URL, skipping\n", cam.CameraID)
			continue
		}

		onvifPort := 80

		fmt.Printf("[Motion] %s: connecting to ONVIF at %s:%d...\n", cam.CameraID, hostname, onvifPort)

		sub, err := onvif.Subscribe(hostname, onvifPort, cam.OnvifUser, cam.OnvifPassword, func(data []byte) {
			handleONVIFEvent(cfg, cam.CameraID, data)
		})

		if err != nil {
			fmt.Printf("[Motion] %s: ONVIF connection failed (streaming still works): %s\n", cam.CameraID, err)
			continue
		}

		activeSubscriptionsMu.Lock()
		activeSubscriptions = append(activeSubscriptions, sub)
		activeSubscriptionsMu.Unlock()

		fmt.Printf("[Motion] %s: ONVIF connected, subscribing to events\n", cam.CameraID)
	}
}

// StopMotionDetect stops all ONVIF event subscriptions and cleans up.
func StopMotionDetect() {
	motionStoppedMu.Lock()
	motionStopped = true
	motionStoppedMu.Unlock()

	fmt.Println("[Motion] Stopping motion detection...")

	activeSubscriptionsMu.Lock()
	for _, sub := range activeSubscriptions {
		sub.Close()
	}
	activeSubscriptions = nil
	activeSubscriptionsMu.Unlock()

	lastMotionTimestampsMu.Lock()
	lastMotionTimestamps = make(map[string]time.Time)
	lastMotionTimestampsMu.Unlock()

	fmt.Println("[Motion] Motion detection stopped")
}

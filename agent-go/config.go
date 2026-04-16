package main

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// CameraConfig holds the configuration for a single camera.
type CameraConfig struct {
	CameraID      string
	RtspURL       string
	OnvifUser     string
	OnvifPassword string
}

// AgentConfig holds all agent configuration loaded from environment variables.
type AgentConfig struct {
	APIUrl              string
	SchoolID            string
	APIKey              string
	HeartbeatInterval   int // milliseconds
	Cameras             []CameraConfig
	MediamtxPath        string
	MediamtxConfig      string
	LocalStoragePath    string
	LocalStorageEnabled bool
	TranscodeEnabled    bool
	NvencEnabled        bool
	TranscodeBitrate    int
	AgentPublicURL      string
	RetentionDays       int
	FfmpegPath          string
	CentralServerURL    string
	CentralServerAPIKey string
}

// LoadConfig reads configuration from environment variables.
func LoadConfig() *AgentConfig {
	cfg := &AgentConfig{
		APIUrl:              envOrDefault("API_URL", "http://localhost:3000"),
		SchoolID:            envOrDefault("SCHOOL_ID", ""),
		APIKey:              envOrDefault("API_KEY", ""),
		HeartbeatInterval:   envIntOrDefault("HEARTBEAT_INTERVAL", 30000),
		Cameras:             parseCameras(envOrDefault("CAMERAS", "")),
		MediamtxPath:        envOrDefault("MEDIAMTX_PATH", ""),
		MediamtxConfig:      envOrDefault("MEDIAMTX_CONFIG", ""),
		LocalStoragePath:    envOrDefault("LOCAL_STORAGE_PATH", "./recordings"),
		LocalStorageEnabled: os.Getenv("LOCAL_STORAGE_ENABLED") == "true",
		TranscodeEnabled:    os.Getenv("TRANSCODE_ENABLED") != "false", // default true
		NvencEnabled:        os.Getenv("NVENC_ENABLED") != "false",     // default true
		TranscodeBitrate:    envIntOrDefault("TRANSCODE_BITRATE", 4000),
		AgentPublicURL:      envOrDefault("AGENT_PUBLIC_URL", ""),
		RetentionDays:       envIntOrDefault("RETENTION_DAYS", 14),
		FfmpegPath:          envOrDefault("FFMPEG_PATH", "ffmpeg"),
		CentralServerURL:    envOrDefault("CENTRAL_SERVER_URL", ""),
		CentralServerAPIKey: envOrDefault("CENTRAL_SERVER_API_KEY", ""),
	}

	return cfg
}

// PrintBanner prints the startup banner with configuration summary.
func PrintBanner(cfg *AgentConfig) {
	fmt.Println("═══════════════════════════════════════════")
	fmt.Println("  SafeGuard Agent — On-Premises Security")
	fmt.Println("═══════════════════════════════════════════")
	fmt.Printf("  School ID:  %s\n", cfg.SchoolID)
	fmt.Printf("  API URL:    %s\n", cfg.APIUrl)
	fmt.Printf("  Cameras:    %d\n", len(cfg.Cameras))
	fmt.Printf("  Heartbeat:  %dms\n", cfg.HeartbeatInterval)

	transcodeStr := "disabled"
	if cfg.TranscodeEnabled {
		transcodeStr = "enabled"
	}
	nvencStr := "disabled"
	if cfg.NvencEnabled {
		nvencStr = "allowed"
	}
	fmt.Printf("  Transcode:  %s (NVENC: %s, bitrate: %d kbps)\n", transcodeStr, nvencStr, cfg.TranscodeBitrate)

	if cfg.LocalStorageEnabled {
		fmt.Printf("  Storage:    enabled (%s, %dd retention, ffmpeg: %s)\n", cfg.LocalStoragePath, cfg.RetentionDays, cfg.FfmpegPath)
	} else {
		fmt.Println("  Storage:    disabled")
	}

	publicURL := cfg.AgentPublicURL
	if publicURL == "" {
		publicURL = "(not set)"
	}
	fmt.Printf("  Public URL: %s\n", publicURL)

	centralNVR := cfg.CentralServerURL
	if centralNVR == "" {
		centralNVR = "(disabled)"
	}
	fmt.Printf("  Central NVR: %s\n", centralNVR)
	fmt.Println("═══════════════════════════════════════════")
	fmt.Println()
}

// parseCameras parses the CAMERAS environment variable.
//
// Format per camera: cameraId:rtspUrl[:onvifUser:onvifPassword]
// Multiple cameras are comma-separated.
//
// Examples:
//
//	CAM-01:rtsp://192.168.1.100:554/stream1:admin:password123
//	CAM-02:rtsp://192.168.1.102:554/stream1
func parseCameras(str string) []CameraConfig {
	if strings.TrimSpace(str) == "" {
		return nil
	}

	credRe := regexp.MustCompile(`^(/[^:]*):([^:]+):(.+)$`)
	var cameras []CameraConfig

	for _, entry := range strings.Split(str, ",") {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" {
			continue
		}

		// cameraId is everything before the first colon
		firstColon := strings.Index(trimmed, ":")
		if firstColon == -1 {
			cameras = append(cameras, CameraConfig{CameraID: trimmed})
			continue
		}

		cameraID := strings.TrimSpace(trimmed[:firstColon])
		rest := strings.TrimSpace(trimmed[firstColon+1:])

		// The RTSP URL ends with a path (e.g. /stream1, /h264, /1).
		// ONVIF credentials come after that path segment as :user:pass.
		lastSlash := strings.LastIndex(rest, "/")
		if lastSlash > -1 {
			afterPath := rest[lastSlash:]
			matches := credRe.FindStringSubmatch(afterPath)
			if matches != nil {
				rtspURL := rest[:lastSlash] + matches[1]
				cameras = append(cameras, CameraConfig{
					CameraID:      cameraID,
					RtspURL:       rtspURL,
					OnvifUser:     matches[2],
					OnvifPassword: matches[3],
				})
				continue
			}
		}

		// No ONVIF credentials — entire rest is the RTSP URL
		cameras = append(cameras, CameraConfig{
			CameraID: cameraID,
			RtspURL:  rest,
		})
	}

	return cameras
}

func envOrDefault(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func envIntOrDefault(key string, fallback int) int {
	val := os.Getenv(key)
	if val == "" {
		return fallback
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return fallback
	}
	return n
}

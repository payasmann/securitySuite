package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// VideoEncoderSettings holds resolved video encoder configuration.
type VideoEncoderSettings struct {
	VideoEncoder string
	VideoCodec   string
	VideoProfile string
	VideoPreset  string
	VideoBitrate int // 0 means not set
}

var (
	mediamtxCmd     *exec.Cmd
	mediamtxMu      sync.Mutex
	restartCount    int
	restartTimer    *time.Timer
	stabilityTimer  *time.Timer
	nvencAvailable  *bool // nil = not yet detected
	maxRestartDelay = 60 * time.Second
)

// detectNvenc checks whether an NVIDIA GPU with NVENC is available.
// Result is cached after the first call.
func detectNvenc() bool {
	if nvencAvailable != nil {
		return *nvencAvailable
	}

	cmd := exec.Command("nvidia-smi")
	err := cmd.Run()
	result := err == nil
	nvencAvailable = &result

	return result
}

// resolveVideoEncoder determines video encoder settings from config and GPU availability.
func resolveVideoEncoder(cfg *AgentConfig) VideoEncoderSettings {
	if !cfg.TranscodeEnabled {
		return VideoEncoderSettings{
			VideoEncoder: "copy",
		}
	}

	useNvenc := cfg.NvencEnabled && detectNvenc()

	if useNvenc {
		return VideoEncoderSettings{
			VideoEncoder: "h264",
			VideoCodec:   "h264_nvenc",
			VideoProfile: "baseline",
			VideoPreset:  "p2",
			VideoBitrate: cfg.TranscodeBitrate,
		}
	}

	// Software fallback
	return VideoEncoderSettings{
		VideoEncoder: "h264",
		VideoCodec:   "libx264",
		VideoProfile: "baseline",
		VideoPreset:  "ultrafast",
		VideoBitrate: cfg.TranscodeBitrate,
	}
}

// logEncoderChoice logs which video encoder will be used.
func logEncoderChoice(cfg *AgentConfig) {
	if !cfg.TranscodeEnabled {
		fmt.Println("[StreamBridge] Video encoder: copy (transcoding disabled)")
		return
	}

	useNvenc := cfg.NvencEnabled && detectNvenc()
	if useNvenc {
		fmt.Println("[StreamBridge] Video encoder: h264_nvenc (NVIDIA GPU detected)")
	} else {
		fmt.Println("[StreamBridge] Video encoder: libx264 (software fallback — NVENC not available)")
	}
}

// generateMediaMTXConfig generates a MediaMTX YAML configuration string.
func generateMediaMTXConfig(cfg *AgentConfig) string {
	var b strings.Builder

	b.WriteString("# Auto-generated MediaMTX configuration\n")
	b.WriteString("# Do not edit manually — regenerated on agent startup\n\n")
	b.WriteString("logLevel: info\n")
	b.WriteString("logDestinations: [stdout]\n\n")
	b.WriteString("api: yes\n")
	b.WriteString("apiAddress: :9997\n\n")
	b.WriteString("rtsp: yes\n")
	b.WriteString("rtspAddress: :8554\n\n")
	b.WriteString("webrtc: yes\n")
	b.WriteString("webrtcAddress: :8889\n\n")
	b.WriteString("paths:\n")

	if len(cfg.Cameras) == 0 {
		b.WriteString("  # No cameras configured\n")
		return b.String()
	}

	encoder := resolveVideoEncoder(cfg)

	for _, cam := range cfg.Cameras {
		b.WriteString(fmt.Sprintf("  %s:\n", cam.CameraID))
		b.WriteString(fmt.Sprintf("    source: %s\n", cam.RtspURL))
		b.WriteString("    sourceProtocol: tcp\n")
		b.WriteString(fmt.Sprintf("    videoEncoder: %s\n", encoder.VideoEncoder))

		if encoder.VideoEncoder != "copy" {
			b.WriteString(fmt.Sprintf("    videoCodec: %s\n", encoder.VideoCodec))
			b.WriteString(fmt.Sprintf("    videoProfile: %s\n", encoder.VideoProfile))
			b.WriteString(fmt.Sprintf("    videoPreset: %s\n", encoder.VideoPreset))
			if encoder.VideoBitrate > 0 {
				b.WriteString(fmt.Sprintf("    videoBitrate: %d\n", encoder.VideoBitrate))
			}
		}

		b.WriteString("    audioEncoder: copy\n")
	}

	return b.String()
}

// writeMediaMTXConfig writes the generated config to disk and returns the path.
func writeMediaMTXConfig(cfg *AgentConfig) (string, error) {
	configPath := cfg.MediamtxConfig
	if configPath == "" {
		configPath = "./mediamtx-generated.yml"
	}
	configPath, _ = filepath.Abs(configPath)

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
		return "", fmt.Errorf("create config dir: %w", err)
	}

	yaml := generateMediaMTXConfig(cfg)
	if err := os.WriteFile(configPath, []byte(yaml), 0644); err != nil {
		return "", fmt.Errorf("write config: %w", err)
	}

	fmt.Printf("[StreamBridge] Wrote MediaMTX config to %s\n", configPath)
	fmt.Printf("[StreamBridge] Configured %d camera path(s) with audio passthrough\n", len(cfg.Cameras))

	return configPath, nil
}

func clearStreamTimers() {
	mediamtxMu.Lock()
	defer mediamtxMu.Unlock()

	if restartTimer != nil {
		restartTimer.Stop()
		restartTimer = nil
	}
	if stabilityTimer != nil {
		stabilityTimer.Stop()
		stabilityTimer = nil
	}
}

// startMediaMTX starts the MediaMTX process with auto-restart.
func startMediaMTX(cfg *AgentConfig) {
	if cfg.MediamtxPath == "" {
		return
	}

	configPath, err := writeMediaMTXConfig(cfg)
	if err != nil {
		fmt.Printf("[StreamBridge] Failed to write config: %s\n", err)
		return
	}

	fmt.Println("[StreamBridge] Starting MediaMTX...")

	mediamtxMu.Lock()
	cmd := exec.Command(cfg.MediamtxPath, configPath)
	mediamtxCmd = cmd
	mediamtxMu.Unlock()

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		fmt.Printf("[StreamBridge] Failed to start MediaMTX: %s\n", err)
		mediamtxMu.Lock()
		mediamtxCmd = nil
		mediamtxMu.Unlock()
		return
	}

	// Stream stdout
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line != "" {
				fmt.Printf("[MediaMTX] %s\n", line)
			}
		}
	}()

	// Stream stderr
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line != "" {
				fmt.Printf("[MediaMTX ERR] %s\n", line)
			}
		}
	}()

	// Reset restart counter after a stable run (2 minutes)
	mediamtxMu.Lock()
	stabilityTimer = time.AfterFunc(2*time.Minute, func() {
		mediamtxMu.Lock()
		defer mediamtxMu.Unlock()
		if mediamtxCmd != nil {
			restartCount = 0
		}
	})
	mediamtxMu.Unlock()

	// Wait for process exit in background and auto-restart
	go func() {
		err := cmd.Wait()

		mediamtxMu.Lock()
		mediamtxCmd = nil
		mediamtxMu.Unlock()

		exitMsg := "unknown"
		if err != nil {
			exitMsg = err.Error()
		}
		fmt.Printf("[StreamBridge] MediaMTX exited (%s)\n", exitMsg)

		// Auto-restart with exponential backoff
		restartCount++
		delay := time.Duration(1<<uint(restartCount-1)) * time.Second
		if delay > maxRestartDelay {
			delay = maxRestartDelay
		}

		fmt.Printf("[StreamBridge] Restarting in %v (attempt #%d)\n", delay, restartCount)

		mediamtxMu.Lock()
		restartTimer = time.AfterFunc(delay, func() {
			startMediaMTX(cfg)
		})
		mediamtxMu.Unlock()
	}()
}

// StartStreamBridge detects GPU, logs encoder choice, and starts MediaMTX.
func StartStreamBridge(cfg *AgentConfig) {
	// Run NVENC detection once at startup
	detectNvenc()

	// Log the encoder that will be used
	logEncoderChoice(cfg)

	// Log WHEP endpoint URLs
	whepBase := cfg.AgentPublicURL
	if whepBase == "" {
		whepBase = "http://localhost:8889"
	}
	for _, cam := range cfg.Cameras {
		fmt.Printf("[StreamBridge] WHEP endpoint: %s/%s/whep\n", whepBase, cam.CameraID)
	}

	startMediaMTX(cfg)
}

// StopStreamBridge stops MediaMTX and clears all timers.
func StopStreamBridge() {
	clearStreamTimers()

	mediamtxMu.Lock()
	defer mediamtxMu.Unlock()

	if mediamtxCmd != nil && mediamtxCmd.Process != nil {
		fmt.Println("[StreamBridge] Stopping MediaMTX...")
		mediamtxCmd.Process.Signal(os.Interrupt)
		mediamtxCmd = nil
	}
}

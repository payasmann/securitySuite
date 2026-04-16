package main

import (
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

// RecordingStatus holds the current state of active recordings.
type RecordingStatus struct {
	ActiveRecordings int
	Cameras          []string
}

var (
	recordingProcesses   = make(map[string]*exec.Cmd)
	recordingProcessesMu sync.Mutex
	retryCounts          = make(map[string]int)
	retryCountsMu        sync.Mutex
	storageConfig        *AgentConfig
	cleanupTimerStorage  *time.Timer

	dateRegex    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	segmentRegex = regexp.MustCompile(`^segment_.*\.mp4$`)

	maxRetries    = 5
	baseBackoffMS = 5000
)

// checkFfmpeg verifies that FFmpeg is available at the given path.
func checkFfmpeg(ffmpegPath string) bool {
	cmd := exec.Command(ffmpegPath, "-version")
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run() == nil
}

// startRecording starts an FFmpeg recording process for a single camera.
func startRecording(camera CameraConfig, cfg *AgentConfig) {
	cameraID := camera.CameraID

	// Build output path with strftime placeholders
	outputPattern := filepath.Join(
		cfg.LocalStoragePath,
		cameraID,
		"%Y-%m-%d",
		"segment_%H-%M-%S.mp4",
	)

	// Ensure camera base directory exists
	cameraDir := filepath.Join(cfg.LocalStoragePath, cameraID)
	os.MkdirAll(cameraDir, 0755)

	args := []string{
		"-rtsp_transport", "tcp",
		"-i", camera.RtspURL,
		"-c", "copy",
		"-f", "segment",
		"-segment_time", "600",
		"-segment_format", "mp4",
		"-strftime", "1",
		"-reset_timestamps", "1",
		outputPattern,
	}

	fmt.Printf("[Storage] Starting recording for %s\n", cameraID)

	cmd := exec.Command(cfg.FfmpegPath, args...)
	cmd.Stdout = nil

	// Capture stderr for error logging
	stderrPipe, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		fmt.Printf("[Storage] Failed to start FFmpeg for %s: %s\n", cameraID, err)
		return
	}

	recordingProcessesMu.Lock()
	recordingProcesses[cameraID] = cmd
	recordingProcessesMu.Unlock()

	// Read stderr in background
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderrPipe.Read(buf)
			if n > 0 {
				line := strings.TrimSpace(string(buf[:n]))
				if strings.Contains(line, "Error") || strings.Contains(line, "error") || strings.Contains(line, "fatal") {
					fmt.Printf("[Storage] FFmpeg %s: %s\n", cameraID, line)
				}
			}
			if err != nil {
				break
			}
		}
	}()

	// Wait for exit and handle restart
	go func() {
		err := cmd.Wait()

		recordingProcessesMu.Lock()
		delete(recordingProcesses, cameraID)
		recordingProcessesMu.Unlock()

		// Check if it was a graceful shutdown
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
					if status.Signal() == syscall.SIGTERM || status.Signal() == syscall.SIGINT {
						fmt.Printf("[Storage] Recording stopped for %s (shutdown)\n", cameraID)
						return
					}
				}
			}
		}

		retryCountsMu.Lock()
		retries := retryCounts[cameraID]
		retryCountsMu.Unlock()

		if retries >= maxRetries {
			fmt.Printf("[Storage] ERROR: FFmpeg for %s crashed %d times — giving up\n", cameraID, maxRetries)
			return
		}

		backoffMs := baseBackoffMS * int(math.Pow(2, float64(retries)))

		retryCountsMu.Lock()
		retryCounts[cameraID] = retries + 1
		retryCountsMu.Unlock()

		exitCode := -1
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			}
		}

		fmt.Printf("[Storage] FFmpeg for %s exited (code=%d). Restarting in %dms (retry %d/%d)\n",
			cameraID, exitCode, backoffMs, retries+1, maxRetries)

		time.AfterFunc(time.Duration(backoffMs)*time.Millisecond, func() {
			if storageConfig != nil {
				startRecording(camera, storageConfig)
			}
		})
	}()

	// Reset retry count after 10s of stability
	time.AfterFunc(10*time.Second, func() {
		recordingProcessesMu.Lock()
		_, running := recordingProcesses[cameraID]
		recordingProcessesMu.Unlock()
		if running {
			retryCountsMu.Lock()
			retryCounts[cameraID] = 0
			retryCountsMu.Unlock()
		}
	})
}

// getDirectorySize calculates the total size of a directory recursively.
func getDirectorySize(dirPath string) int64 {
	var totalSize int64

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return 0
	}

	for _, entry := range entries {
		fullPath := filepath.Join(dirPath, entry.Name())
		if entry.IsDir() {
			totalSize += getDirectorySize(fullPath)
		} else {
			info, err := entry.Info()
			if err == nil {
				totalSize += info.Size()
			}
		}
	}

	return totalSize
}

// runCleanup removes recording directories older than the retention period.
func runCleanup(storagePath string, retentionDays int) {
	fmt.Printf("[Storage] Running retention cleanup (keeping %d days)\n", retentionDays)

	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	cutoff = time.Date(cutoff.Year(), cutoff.Month(), cutoff.Day(), 0, 0, 0, 0, time.Local)

	var totalFreed int64
	dirsRemoved := 0

	cameraDirs, err := os.ReadDir(storagePath)
	if err != nil {
		fmt.Printf("[Storage] Cannot read storage path: %s\n", storagePath)
		return
	}

	for _, cameraEntry := range cameraDirs {
		if !cameraEntry.IsDir() {
			continue
		}

		cameraPath := filepath.Join(storagePath, cameraEntry.Name())
		dateDirs, err := os.ReadDir(cameraPath)
		if err != nil {
			continue
		}

		for _, dateEntry := range dateDirs {
			if !dateEntry.IsDir() {
				continue
			}
			if !dateRegex.MatchString(dateEntry.Name()) {
				continue
			}

			dirDate, err := time.Parse("2006-01-02", dateEntry.Name())
			if err != nil {
				continue
			}

			if dirDate.Before(cutoff) {
				dirPath := filepath.Join(cameraPath, dateEntry.Name())
				dirSize := getDirectorySize(dirPath)

				if err := os.RemoveAll(dirPath); err != nil {
					fmt.Printf("[Storage] Failed to remove %s: %s\n", dirPath, err)
				} else {
					totalFreed += dirSize
					dirsRemoved++
					fmt.Printf("[Storage] Removed %s from %s (%.1f MB)\n",
						dateEntry.Name(), cameraEntry.Name(), float64(dirSize)/1024/1024)
				}
			}
		}
	}

	fmt.Printf("[Storage] Cleanup complete: removed %d directories, freed %.1f MB\n",
		dirsRemoved, float64(totalFreed)/1024/1024)
}

// scheduleCleanup schedules daily cleanup at 2:00 AM.
func scheduleCleanup(cfg *AgentConfig) {
	var scheduleNext func()
	scheduleNext = func() {
		now := time.Now()
		next2AM := time.Date(now.Year(), now.Month(), now.Day(), 2, 0, 0, 0, now.Location())

		if now.After(next2AM) {
			next2AM = next2AM.AddDate(0, 0, 1)
		}

		delay := next2AM.Sub(now)
		fmt.Printf("[Storage] Next retention cleanup scheduled in %.1f hours\n", delay.Hours())

		cleanupTimerStorage = time.AfterFunc(delay, func() {
			runCleanup(cfg.LocalStoragePath, cfg.RetentionDays)
			scheduleNext()
		})
	}

	scheduleNext()
}

// InitLocalStorage initializes local recording for all cameras.
func InitLocalStorage(cfg *AgentConfig) {
	if !cfg.LocalStorageEnabled {
		fmt.Println("[Storage] Local storage disabled")
		return
	}

	if !checkFfmpeg(cfg.FfmpegPath) {
		fmt.Printf("[Storage] ERROR: FFmpeg not found at %s — local recording disabled\n", cfg.FfmpegPath)
		return
	}

	fmt.Printf("[Storage] FFmpeg found at %s\n", cfg.FfmpegPath)

	storageConfig = cfg

	// Create storage directory
	if _, err := os.Stat(cfg.LocalStoragePath); os.IsNotExist(err) {
		os.MkdirAll(cfg.LocalStoragePath, 0755)
		fmt.Printf("[Storage] Created storage directory: %s\n", cfg.LocalStoragePath)
	}

	fmt.Printf("[Storage] Local storage initialized at %s\n", cfg.LocalStoragePath)
	fmt.Printf("[Storage] Starting recording for %d cameras\n", len(cfg.Cameras))

	for _, camera := range cfg.Cameras {
		startRecording(camera, cfg)
	}

	scheduleCleanup(cfg)
	fmt.Printf("[Storage] Retention policy: %d days\n", cfg.RetentionDays)
}

// StopAllRecordings stops all active FFmpeg recording processes.
func StopAllRecordings() {
	recordingProcessesMu.Lock()
	defer recordingProcessesMu.Unlock()

	fmt.Printf("[Storage] Stopping %d recording(s)...\n", len(recordingProcesses))

	for cameraID, cmd := range recordingProcesses {
		if cmd.Process != nil {
			cmd.Process.Signal(syscall.SIGTERM)
			fmt.Printf("[Storage] Stopped recording for %s\n", cameraID)
		}
	}

	recordingProcesses = make(map[string]*exec.Cmd)

	retryCountsMu.Lock()
	retryCounts = make(map[string]int)
	retryCountsMu.Unlock()

	if cleanupTimerStorage != nil {
		cleanupTimerStorage.Stop()
		cleanupTimerStorage = nil
	}
}

// GetRecordingStatus returns the current recording status.
func GetRecordingStatus() RecordingStatus {
	recordingProcessesMu.Lock()
	defer recordingProcessesMu.Unlock()

	cameras := make([]string, 0, len(recordingProcesses))
	for cameraID := range recordingProcesses {
		cameras = append(cameras, cameraID)
	}

	return RecordingStatus{
		ActiveRecordings: len(cameras),
		Cameras:          cameras,
	}
}

// GetDiskUsageGB returns the total disk usage in GB for the storage directory.
func GetDiskUsageGB() float64 {
	if storageConfig == nil {
		return 0
	}

	totalBytes := getDirectorySize(storageConfig.LocalStoragePath)
	return math.Round(float64(totalBytes)/1073741824*100) / 100
}

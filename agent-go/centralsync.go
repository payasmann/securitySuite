package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Central sync constants
const (
	scanIntervalMS       = 60_000
	uploadIntervalMS     = 30_000
	maxSyncRetries       = 10
	syncBaseBackoffMS    = 5_000
	maxBackoffMultiplier = 256 // 2^8
	fileSettleMS         = 30_000
	queuePruneDays       = 7
	queueFilename        = ".central-sync-queue.json"
)

// QueueEntry represents a single recording segment in the upload queue.
type QueueEntry struct {
	CameraID    string  `json:"cameraId"`
	Date        string  `json:"date"`
	Segment     string  `json:"segment"`
	FilePath    string  `json:"filePath"`
	Status      string  `json:"status"` // "pending" or "uploaded"
	AddedAt     string  `json:"addedAt"`
	UploadedAt  *string `json:"uploadedAt"`
	LastAttempt *string `json:"lastAttempt"`
	Attempts    int     `json:"attempts"`
}

var (
	syncConfig    *AgentConfig
	scanTimer     *time.Ticker
	uploadTimer   *time.Ticker
	syncStopCh    chan struct{}
	isUploading   bool
	isUploadingMu sync.Mutex
	syncDateRegex = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	syncSegRegex  = regexp.MustCompile(`^segment_.*\.mp4$`)
)

// getQueuePath returns the path to the queue persistence file.
func getQueuePath() string {
	return filepath.Join(syncConfig.LocalStoragePath, queueFilename)
}

// loadQueue reads the queue from disk.
func loadQueue() []QueueEntry {
	queuePath := getQueuePath()

	data, err := os.ReadFile(queuePath)
	if err != nil {
		return nil
	}

	var queue []QueueEntry
	if err := json.Unmarshal(data, &queue); err != nil {
		fmt.Printf("[CentralSync] Failed to load queue: %s\n", err)
		return nil
	}

	return queue
}

// saveQueue writes the queue to disk atomically.
func saveQueue(queue []QueueEntry) {
	queuePath := getQueuePath()
	tmpPath := queuePath + ".tmp"

	data, err := json.MarshalIndent(queue, "", "  ")
	if err != nil {
		fmt.Printf("[CentralSync] Failed to marshal queue: %s\n", err)
		return
	}

	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		fmt.Printf("[CentralSync] Failed to write queue: %s\n", err)
		return
	}

	if err := os.Rename(tmpPath, queuePath); err != nil {
		fmt.Printf("[CentralSync] Failed to save queue: %s\n", err)
	}
}

// scanForNewSegments scans the recording directories for new segments.
func scanForNewSegments() {
	if syncConfig == nil {
		return
	}

	queue := loadQueue()
	existingPaths := make(map[string]bool)
	for _, e := range queue {
		existingPaths[e.FilePath] = true
	}

	added := 0

	for _, camera := range syncConfig.Cameras {
		cameraDir := filepath.Join(syncConfig.LocalStoragePath, camera.CameraID)
		if _, err := os.Stat(cameraDir); os.IsNotExist(err) {
			continue
		}

		dateDirs, err := os.ReadDir(cameraDir)
		if err != nil {
			continue
		}

		for _, dateEntry := range dateDirs {
			if !dateEntry.IsDir() || !syncDateRegex.MatchString(dateEntry.Name()) {
				continue
			}

			datePath := filepath.Join(cameraDir, dateEntry.Name())
			files, err := os.ReadDir(datePath)
			if err != nil {
				continue
			}

			// Collect segment files
			var segmentFiles []string
			for _, f := range files {
				if !f.IsDir() && syncSegRegex.MatchString(f.Name()) {
					segmentFiles = append(segmentFiles, f.Name())
				}
			}

			if len(segmentFiles) == 0 {
				continue
			}

			sort.Strings(segmentFiles)

			// Skip the last file — may still be written by FFmpeg
			if len(segmentFiles) > 1 {
				segmentFiles = segmentFiles[:len(segmentFiles)-1]
			} else {
				continue
			}

			now := time.Now()

			for _, segment := range segmentFiles {
				filePath := filepath.Join(datePath, segment)

				if existingPaths[filePath] {
					continue
				}

				info, err := os.Stat(filePath)
				if err != nil {
					continue
				}

				// Skip empty files
				if info.Size() == 0 {
					continue
				}

				// Skip files modified in the last 30 seconds
				if now.Sub(info.ModTime()) < time.Duration(fileSettleMS)*time.Millisecond {
					continue
				}

				addedAt := time.Now().UTC().Format(time.RFC3339)
				queue = append(queue, QueueEntry{
					CameraID:    camera.CameraID,
					Date:        dateEntry.Name(),
					Segment:     segment,
					FilePath:    filePath,
					Status:      "pending",
					AddedAt:     addedAt,
					UploadedAt:  nil,
					LastAttempt: nil,
					Attempts:    0,
				})
				existingPaths[filePath] = true
				added++
			}
		}
	}

	if added > 0 {
		saveQueue(queue)
		fmt.Printf("[CentralSync] Scanner found %d new segment(s)\n", added)
	}
}

// getBackoffMs calculates backoff duration based on attempt count.
func getSyncBackoffMs(attempts int) int {
	multiplier := int(math.Min(math.Pow(2, float64(attempts)), float64(maxBackoffMultiplier)))
	return syncBaseBackoffMS * multiplier
}

// isInBackoff checks if an entry is still in its backoff period.
func isInBackoff(entry *QueueEntry) bool {
	if entry.LastAttempt == nil || entry.Attempts == 0 {
		return false
	}

	lastAttempt, err := time.Parse(time.RFC3339, *entry.LastAttempt)
	if err != nil {
		return false
	}

	backoffMs := getSyncBackoffMs(entry.Attempts)
	return time.Since(lastAttempt) < time.Duration(backoffMs)*time.Millisecond
}

// uploadSegment uploads a single recording segment to the central server.
func uploadSegment(entry *QueueEntry, centralURL, apiKey string) bool {
	// If the file was deleted by retention, mark as uploaded
	if _, err := os.Stat(entry.FilePath); os.IsNotExist(err) {
		fmt.Printf("[CentralSync] File no longer exists (retention?), skipping: %s\n", entry.Segment)
		return true
	}

	file, err := os.Open(entry.FilePath)
	if err != nil {
		fmt.Printf("[CentralSync] Failed to read %s: %s\n", entry.Segment, err)
		return false
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		fmt.Printf("[CentralSync] Failed to stat %s: %s\n", entry.Segment, err)
		return false
	}

	reqURL := strings.TrimRight(centralURL, "/") + "/api/v1/recordings/ingest"
	req, err := http.NewRequest("POST", reqURL, file)
	if err != nil {
		fmt.Printf("[CentralSync] Failed to create request for %s: %s\n", entry.Segment, err)
		return false
	}

	req.Header.Set("Content-Type", "video/mp4")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", info.Size()))
	req.Header.Set("X-School-ID", syncConfig.SchoolID)
	req.Header.Set("X-API-Key", apiKey)
	req.Header.Set("X-Camera-ID", entry.CameraID)
	req.Header.Set("X-Date", entry.Date)
	req.Header.Set("X-Segment", entry.Segment)

	resp, err := httpClient.Do(req)
	if err != nil {
		fmt.Printf("[CentralSync] Network error uploading %s: %s\n", entry.Segment, err)
		return false
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case 200:
		fmt.Printf("[CentralSync] Uploaded %s/%s/%s\n", entry.CameraID, entry.Date, entry.Segment)
		return true
	case 409:
		fmt.Printf("[CentralSync] Already exists on server: %s/%s/%s\n", entry.CameraID, entry.Date, entry.Segment)
		return true
	default:
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("[CentralSync] Upload failed (%d): %s/%s/%s — %s\n",
			resp.StatusCode, entry.CameraID, entry.Date, entry.Segment, string(body))
		return false
	}
}

// runUploadCycle processes one round of uploads.
func runUploadCycle() {
	isUploadingMu.Lock()
	if isUploading || syncConfig == nil {
		isUploadingMu.Unlock()
		return
	}
	isUploading = true
	isUploadingMu.Unlock()

	defer func() {
		isUploadingMu.Lock()
		isUploading = false
		isUploadingMu.Unlock()
	}()

	centralURL := syncConfig.CentralServerURL
	apiKey := syncConfig.CentralServerAPIKey
	if apiKey == "" {
		apiKey = syncConfig.APIKey
	}

	queue := loadQueue()

	// Group pending entries by camera
	pendingByCamera := make(map[string][]*QueueEntry)
	for i := range queue {
		entry := &queue[i]
		if entry.Status != "pending" {
			continue
		}
		if entry.Attempts >= maxSyncRetries {
			continue
		}
		if isInBackoff(entry) {
			continue
		}
		pendingByCamera[entry.CameraID] = append(pendingByCamera[entry.CameraID], entry)
	}

	// For each camera, upload the oldest pending segment
	for _, entries := range pendingByCamera {
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].AddedAt < entries[j].AddedAt
		})

		entry := entries[0]
		success := uploadSegment(entry, centralURL, apiKey)

		if success {
			entry.Status = "uploaded"
			now := time.Now().UTC().Format(time.RFC3339)
			entry.UploadedAt = &now
		} else {
			entry.Attempts++
			now := time.Now().UTC().Format(time.RFC3339)
			entry.LastAttempt = &now
		}
	}

	// Prune old entries
	cutoff := time.Now().Add(-time.Duration(queuePruneDays) * 24 * time.Hour)
	var prunedQueue []QueueEntry
	for _, entry := range queue {
		addedAt, err := time.Parse(time.RFC3339, entry.AddedAt)
		if err != nil {
			prunedQueue = append(prunedQueue, entry)
			continue
		}

		if addedAt.After(cutoff) {
			prunedQueue = append(prunedQueue, entry)
			continue
		}

		// Keep entries that are still pending and haven't exceeded retries
		if entry.Status == "pending" && entry.Attempts < maxSyncRetries {
			prunedQueue = append(prunedQueue, entry)
			continue
		}
	}

	saveQueue(prunedQueue)
}

// InitCentralSync initializes the central NVR sync pipeline.
func InitCentralSync(cfg *AgentConfig) {
	if cfg.CentralServerURL == "" {
		return
	}

	syncConfig = cfg

	// Ensure storage directory exists for the queue file
	os.MkdirAll(cfg.LocalStoragePath, 0755)

	// Startup logging
	queue := loadQueue()
	pendingCount := 0
	uploadedCount := 0
	for _, e := range queue {
		switch e.Status {
		case "pending":
			pendingCount++
		case "uploaded":
			uploadedCount++
		}
	}

	fmt.Printf("[CentralSync] Central server: %s\n", cfg.CentralServerURL)
	fmt.Printf("[CentralSync] Queue stats — pending: %d, uploaded: %d\n", pendingCount, uploadedCount)

	syncStopCh = make(chan struct{})

	// Initial scan and upload
	scanForNewSegments()
	runUploadCycle()

	// Start periodic scanner
	scanTimer = time.NewTicker(time.Duration(scanIntervalMS) * time.Millisecond)
	go func() {
		for {
			select {
			case <-scanTimer.C:
				scanForNewSegments()
			case <-syncStopCh:
				return
			}
		}
	}()

	// Start periodic upload worker
	uploadTimer = time.NewTicker(time.Duration(uploadIntervalMS) * time.Millisecond)
	go func() {
		for {
			select {
			case <-uploadTimer.C:
				runUploadCycle()
			case <-syncStopCh:
				return
			}
		}
	}()
}

// StopCentralSync stops the central sync pipeline.
func StopCentralSync() {
	if syncStopCh != nil {
		close(syncStopCh)
		syncStopCh = nil
	}

	if scanTimer != nil {
		scanTimer.Stop()
		scanTimer = nil
	}

	if uploadTimer != nil {
		uploadTimer.Stop()
		uploadTimer = nil
	}

	syncConfig = nil
}

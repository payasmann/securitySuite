package handlers

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"safeguard-dashboard/internal/auth"
	"safeguard-dashboard/internal/middleware"
	"safeguard-dashboard/internal/permissions"
)

// ─── Regex patterns ─────────────────────────────────────

var (
	datePattern    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	segmentPattern = regexp.MustCompile(`^segment_\d{2}-\d{2}-\d{2}\.mp4$`)
	safeIDPattern  = regexp.MustCompile(`[^a-zA-Z0-9_-]`)
)

// ─── POST /api/recordings/ingest ────────────────────────

// IngestRecording receives MP4 segment uploads from remote agents.
// Feature-gated by CENTRAL_INGEST_ENABLED env var.
// Authenticated via CENTRAL_INGEST_API_KEY with timing-safe comparison.
func (h *Handlers) IngestRecording(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Feature gate.
	if os.Getenv("CENTRAL_INGEST_ENABLED") != "true" {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}

	// Authentication via timing-safe API key comparison.
	expectedKey := os.Getenv("CENTRAL_INGEST_API_KEY")
	if expectedKey != "" {
		providedKey := r.Header.Get("X-API-Key")
		if !auth.TimingSafeCompare(expectedKey, providedKey) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
	}

	// Metadata from headers.
	schoolID := r.Header.Get("X-School-ID")
	cameraID := r.Header.Get("X-Camera-ID")
	date := r.Header.Get("X-Date")
	segment := r.Header.Get("X-Segment")

	if schoolID == "" || cameraID == "" || date == "" || segment == "" {
		writeError(w, http.StatusBadRequest,
			"Missing required headers: X-School-ID, X-Camera-ID, X-Date, X-Segment")
		return
	}

	// Validation.
	if !datePattern.MatchString(date) {
		writeError(w, http.StatusBadRequest, "Invalid date format. Expected YYYY-MM-DD.")
		return
	}
	if !segmentPattern.MatchString(segment) {
		writeError(w, http.StatusBadRequest, "Invalid segment format. Expected segment_HH-MM-SS.mp4.")
		return
	}

	// Sanitize IDs to prevent directory traversal.
	safeSchoolID := safeIDPattern.ReplaceAllString(schoolID, "")
	safeCameraID := safeIDPattern.ReplaceAllString(cameraID, "")

	// Storage path.
	storagePath := os.Getenv("RECORDINGS_PATH")
	if storagePath == "" {
		storagePath = "./central-recordings"
	}
	dirPath := filepath.Join(storagePath, safeSchoolID, safeCameraID, date)
	finalPath := filepath.Join(dirPath, segment)
	tmpPath := finalPath + ".tmp"

	// Duplicate check.
	if _, err := os.Stat(finalPath); err == nil {
		writeJSON(w, http.StatusConflict, map[string]string{
			"status":  "exists",
			"message": "Segment already exists",
		})
		return
	}

	// Ensure directory exists.
	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		log.Printf("[Ingest] MkdirAll error: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to write segment")
		return
	}

	// Request body check.
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "Request body is empty")
		return
	}

	// Atomic write: write to .tmp then rename.
	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		log.Printf("[Ingest] Create tmp file error: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to write segment")
		return
	}

	_, writeErr := io.Copy(tmpFile, r.Body)
	closeErr := tmpFile.Close()

	if writeErr != nil || closeErr != nil {
		// Clean up .tmp file on error.
		os.Remove(tmpPath)
		if writeErr != nil {
			log.Printf("[Ingest] Write error: %v", writeErr)
		}
		if closeErr != nil {
			log.Printf("[Ingest] Close error: %v", closeErr)
		}
		writeError(w, http.StatusInternalServerError, "Failed to write segment")
		return
	}

	// Atomic rename from .tmp to final path.
	if err := os.Rename(tmpPath, finalPath); err != nil {
		os.Remove(tmpPath)
		log.Printf("[Ingest] Rename error: %v", err)
		writeError(w, http.StatusInternalServerError, "Failed to write segment")
		return
	}

	relativePath := fmt.Sprintf("%s/%s/%s/%s", safeSchoolID, safeCameraID, date, segment)
	log.Printf("[Ingest] Stored segment: %s", relativePath)

	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
		"path":   relativePath,
	})
}

// ─── GET /api/recordings/{schoolId}/{cameraId}/{date} ───

type segmentInfo struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"createdAt"`
}

// ListRecordingSegments lists available .mp4 segments for a camera on a given date.
// Feature-gated by CENTRAL_INGEST_ENABLED env var.
func (h *Handlers) ListRecordingSegments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Feature gate.
	if os.Getenv("CENTRAL_INGEST_ENABLED") != "true" {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	schoolID := r.PathValue("schoolId")
	cameraID := r.PathValue("cameraId")
	date := r.PathValue("date")

	safeSchoolID := safeIDPattern.ReplaceAllString(schoolID, "")
	safeCameraID := safeIDPattern.ReplaceAllString(cameraID, "")

	// School access check.
	if !permissions.CanAccessSchoolData(user.Role, user.SchoolID, safeSchoolID) {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	// Validate date.
	if !datePattern.MatchString(date) {
		writeError(w, http.StatusBadRequest, "Invalid date format. Expected YYYY-MM-DD.")
		return
	}

	storagePath := os.Getenv("RECORDINGS_PATH")
	if storagePath == "" {
		storagePath = "./central-recordings"
	}
	dirPath := filepath.Join(storagePath, safeSchoolID, safeCameraID, date)

	// If directory doesn't exist, return empty segments.
	if _, err := os.Stat(dirPath); os.IsNotExist(err) {
		writeJSON(w, http.StatusOK, map[string]any{
			"schoolId": safeSchoolID,
			"cameraId": safeCameraID,
			"date":     date,
			"segments": []segmentInfo{},
		})
		return
	}

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		log.Printf("[Recordings] ReadDir error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	var segments []segmentInfo
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "segment_") || !strings.HasSuffix(name, ".mp4") || strings.HasSuffix(name, ".tmp") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		segments = append(segments, segmentInfo{
			Name:      name,
			Size:      info.Size(),
			CreatedAt: info.ModTime().UTC().Format("2006-01-02T15:04:05.000Z"),
		})
	}

	// Sort segments by name.
	sort.Slice(segments, func(i, j int) bool {
		return segments[i].Name < segments[j].Name
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"schoolId": safeSchoolID,
		"cameraId": safeCameraID,
		"date":     date,
		"segments": segments,
	})
}

// ─── GET /api/recordings/{schoolId}/{cameraId}/{date}/{segment} ──

// StreamRecordingSegment streams a specific MP4 file with HTTP Range support.
// Feature-gated by CENTRAL_INGEST_ENABLED env var.
func (h *Handlers) StreamRecordingSegment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Feature gate.
	if os.Getenv("CENTRAL_INGEST_ENABLED") != "true" {
		writeError(w, http.StatusNotFound, "Not found")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	schoolID := r.PathValue("schoolId")
	cameraID := r.PathValue("cameraId")
	date := r.PathValue("date")
	segment := r.PathValue("segment")

	safeSchoolID := safeIDPattern.ReplaceAllString(schoolID, "")
	safeCameraID := safeIDPattern.ReplaceAllString(cameraID, "")

	// School access check.
	if !permissions.CanAccessSchoolData(user.Role, user.SchoolID, safeSchoolID) {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	// Validate date.
	if !datePattern.MatchString(date) {
		writeError(w, http.StatusBadRequest, "Invalid date format. Expected YYYY-MM-DD.")
		return
	}

	// Validate segment format.
	if !segmentPattern.MatchString(segment) {
		writeError(w, http.StatusBadRequest, "Invalid segment format. Expected segment_HH-MM-SS.mp4.")
		return
	}

	storagePath := os.Getenv("RECORDINGS_PATH")
	if storagePath == "" {
		storagePath = "./central-recordings"
	}
	filePath := filepath.Join(storagePath, safeSchoolID, safeCameraID, date, segment)

	stat, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "Segment not found")
		return
	}
	if err != nil {
		log.Printf("[Recordings] Stat error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	fileSize := stat.Size()

	// Range request handling.
	rangeHeader := r.Header.Get("Range")
	if rangeHeader != "" {
		// Parse "bytes=START-END"
		if !strings.HasPrefix(rangeHeader, "bytes=") {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
			http.Error(w, "Invalid Range header", http.StatusRequestedRangeNotSatisfiable)
			return
		}

		rangeParts := strings.TrimPrefix(rangeHeader, "bytes=")
		parts := strings.SplitN(rangeParts, "-", 2)
		if len(parts) != 2 {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
			http.Error(w, "Invalid Range header", http.StatusRequestedRangeNotSatisfiable)
			return
		}

		start, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
			http.Error(w, "Invalid Range header", http.StatusRequestedRangeNotSatisfiable)
			return
		}

		var end int64
		if parts[1] == "" {
			end = fileSize - 1
		} else {
			end, err = strconv.ParseInt(parts[1], 10, 64)
			if err != nil {
				w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
				http.Error(w, "Invalid Range header", http.StatusRequestedRangeNotSatisfiable)
				return
			}
		}

		if start >= fileSize || end >= fileSize || start > end {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
			http.Error(w, "Range not satisfiable", http.StatusRequestedRangeNotSatisfiable)
			return
		}

		contentLength := end - start + 1

		f, err := os.Open(filePath)
		if err != nil {
			log.Printf("[Recordings] Open error: %v", err)
			writeError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
		defer f.Close()

		if _, err := f.Seek(start, io.SeekStart); err != nil {
			log.Printf("[Recordings] Seek error: %v", err)
			writeError(w, http.StatusInternalServerError, "Internal server error")
			return
		}

		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Content-Length", strconv.FormatInt(contentLength, 10))
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusPartialContent)

		io.CopyN(w, f, contentLength)
		return
	}

	// Full file response.
	f, err := os.Open(filePath)
	if err != nil {
		log.Printf("[Recordings] Open error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Content-Length", strconv.FormatInt(fileSize, 10))
	w.Header().Set("Accept-Ranges", "bytes")
	w.WriteHeader(http.StatusOK)

	io.Copy(w, f)
}

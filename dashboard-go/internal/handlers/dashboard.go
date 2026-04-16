package handlers

import (
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/middleware"
	"safeguard-dashboard/internal/permissions"
)

// ─── Response Types ─────────────────────────────────────

type dashboardStatsData struct {
	CamerasOnline  int    `json:"camerasOnline"`
	CamerasTotal   int    `json:"camerasTotal"`
	ActiveAlerts   int    `json:"activeAlerts"`
	CriticalAlerts int    `json:"criticalAlerts"`
	MotionEvents   int    `json:"motionEvents"`
	StorageUsed    int    `json:"storageUsed"`
	StorageFree    string `json:"storageFree"`
}

type motionByCameraEntry struct {
	CameraID   string `json:"cameraId"`
	CameraName string `json:"cameraName"`
	Count      int    `json:"count"`
}

type zoneStatus struct {
	Name   string `json:"name"`
	Status string `json:"status"` // "Clear" | "Motion" | "Alert"
}

type recentActivityEntry struct {
	ID      string `json:"id"`
	Time    string `json:"time"`
	Type    string `json:"type"` // "critical" | "warning" | "info"
	Message string `json:"message"`
}

type dashboardResponse struct {
	Stats          dashboardStatsData    `json:"stats"`
	MotionByCamera []motionByCameraEntry `json:"motionByCamera"`
	Zones          []zoneStatus          `json:"zones"`
	RecentActivity []recentActivityEntry `json:"recentActivity"`
}

// ─── Handler ────────────────────────────────────────────

// DashboardStats handles GET /api/dashboard/stats.
// Requires authenticated session. School-scoped: ops users can pass ?schoolId,
// school users use their own school.
func (h *Handlers) DashboardStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	// Determine which school to show data for.
	querySchoolID := r.URL.Query().Get("schoolId")
	var schoolID string

	if permissions.IsOpsRole(user.Role) {
		if querySchoolID != "" {
			schoolID = querySchoolID
		}
	} else {
		schoolID = user.SchoolID
	}

	if schoolID == "" {
		writeError(w, http.StatusBadRequest, "No school context. Provide schoolId parameter.")
		return
	}

	// Verify school-scoped access.
	if !permissions.IsOpsRole(user.Role) && schoolID != user.SchoolID {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	ctx := r.Context()
	now := time.Now().UTC()
	sixtyMinutesAgo := now.Add(-60 * time.Minute)

	// Run all queries in parallel.
	var (
		cameras        []database.Camera
		activeAlerts   int
		criticalAlerts int
		motionTotal    int
		motionByCamera []database.MotionByCamera
		recentAlerts   []database.Alert

		errCameras, errActive, errCritical, errMotion, errMotionBy, errRecent error
		wg                                                                    sync.WaitGroup
	)

	wg.Add(6)

	// 1. Cameras list
	go func() {
		defer wg.Done()
		cameras, errCameras = database.ListCamerasBySchool(ctx, schoolID)
	}()

	// 2. Active (unresolved) alerts count
	go func() {
		defer wg.Done()
		resolved := false
		activeAlerts, errActive = database.CountAlerts(ctx, schoolID, nil, &resolved)
	}()

	// 3. Critical alerts count
	go func() {
		defer wg.Done()
		resolved := false
		critType := database.AlertTypeCritical
		criticalAlerts, errCritical = database.CountAlerts(ctx, schoolID, &critType, &resolved)
	}()

	// 4. Motion events total (last 60 min)
	go func() {
		defer wg.Done()
		const q = `
			SELECT COALESCE(SUM(count), 0)::int
			FROM "MotionEvent"
			WHERE school_id = $1 AND recorded_at >= $2`
		errMotion = h.Pool.QueryRow(ctx, q, schoolID, sixtyMinutesAgo).Scan(&motionTotal)
	}()

	// 5. Motion by camera (top 5, last 60 min)
	go func() {
		defer wg.Done()
		const q = `
			SELECT me.camera_id, c.name, COALESCE(SUM(me.count), 0)::int AS total
			FROM "MotionEvent" me
			JOIN "Camera" c ON c.id = me.camera_id
			WHERE me.school_id = $1
			  AND me.recorded_at >= $2
			GROUP BY me.camera_id, c.name
			ORDER BY total DESC
			LIMIT 5`
		rows, err := h.Pool.Query(ctx, q, schoolID, sixtyMinutesAgo)
		if err != nil {
			errMotionBy = err
			return
		}
		defer rows.Close()
		for rows.Next() {
			var m database.MotionByCamera
			if err := rows.Scan(&m.CameraID, &m.Name, &m.Total); err != nil {
				errMotionBy = err
				return
			}
			motionByCamera = append(motionByCamera, m)
		}
		errMotionBy = rows.Err()
	}()

	// 6. Recent alerts (last 10)
	go func() {
		defer wg.Done()
		recentAlerts, errRecent = database.ListAlerts(ctx, database.AlertListParams{
			SchoolID: schoolID,
			Limit:    10,
			Offset:   0,
		})
	}()

	wg.Wait()

	// Check for errors.
	for _, e := range []error{errCameras, errActive, errCritical, errMotion, errMotionBy, errRecent} {
		if e != nil {
			log.Printf("[Dashboard] Query error: %v", e)
			writeError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
	}

	// Build camera lookup map.
	cameraMap := make(map[string]*database.Camera, len(cameras))
	for i := range cameras {
		cameraMap[cameras[i].ID] = &cameras[i]
	}

	// Count online cameras.
	camerasOnline := 0
	for _, c := range cameras {
		if c.Status == database.CameraStatusOnline {
			camerasOnline++
		}
	}

	// Build motion by camera with display IDs.
	motionByCameraData := make([]motionByCameraEntry, 0, len(motionByCamera))
	for _, m := range motionByCamera {
		cam := cameraMap[m.CameraID]
		displayID := "Unknown"
		cameraName := "Unknown"
		if cam != nil {
			displayID = cam.CameraID
			cameraName = cam.Name
		}
		motionByCameraData = append(motionByCameraData, motionByCameraEntry{
			CameraID:   displayID,
			CameraName: cameraName,
			Count:      m.Total,
		})
	}

	// Build zone status map from cameras.
	motionCameraIDs := make(map[string]bool, len(motionByCamera))
	for _, m := range motionByCamera {
		motionCameraIDs[m.CameraID] = true
	}

	type zoneEntry struct {
		name   string
		status string
	}
	zoneMap := make(map[string]*zoneEntry)
	zoneOrder := make([]string, 0)

	for _, camera := range cameras {
		zone := camera.Zone
		if zone == "" {
			zone = camera.Name
		}
		if _, exists := zoneMap[zone]; !exists {
			name := camera.Name
			if zone == "Entry" {
				name = "Main Entrance"
			}
			zoneMap[zone] = &zoneEntry{name: name, status: "Clear"}
			zoneOrder = append(zoneOrder, zone)
		}
	}

	// Mark zones with motion.
	for _, camera := range cameras {
		if motionCameraIDs[camera.ID] {
			zone := camera.Zone
			if zone == "" {
				zone = camera.Name
			}
			if entry, ok := zoneMap[zone]; ok && entry.status == "Clear" {
				entry.status = "Motion"
			}
		}
		// Mark zones with WARNING/OFFLINE cameras as Alert.
		if camera.Status == database.CameraStatusWarning || camera.Status == database.CameraStatusOffline {
			zone := camera.Zone
			if zone == "" {
				zone = camera.Name
			}
			if entry, ok := zoneMap[zone]; ok {
				entry.status = "Alert"
			}
		}
	}

	zones := make([]zoneStatus, 0, len(zoneMap))
	for _, key := range zoneOrder {
		entry := zoneMap[key]
		zones = append(zones, zoneStatus{
			Name:   entry.name,
			Status: entry.status,
		})
	}

	// Build recent activity from alerts.
	// Build camera lookup for alerts (need camera info from alert.CameraID).
	recentActivity := make([]recentActivityEntry, 0, len(recentAlerts))
	for _, alert := range recentAlerts {
		timeStr := alert.CreatedAt.Format("15:04")

		alertType := "info"
		switch alert.Type {
		case database.AlertTypeCritical:
			alertType = "critical"
		case database.AlertTypeWarning:
			alertType = "warning"
		}

		message := alert.Title
		if alert.CameraID != nil {
			if cam, ok := cameraMap[*alert.CameraID]; ok {
				message = fmt.Sprintf("%s — %s (%s)", alert.Title, cam.Name, cam.CameraID)
			}
		}

		recentActivity = append(recentActivity, recentActivityEntry{
			ID:      alert.ID,
			Time:    timeStr,
			Type:    alertType,
			Message: message,
		})
	}

	writeJSON(w, http.StatusOK, dashboardResponse{
		Stats: dashboardStatsData{
			CamerasOnline:  camerasOnline,
			CamerasTotal:   len(cameras),
			ActiveAlerts:   activeAlerts,
			CriticalAlerts: criticalAlerts,
			MotionEvents:   motionTotal,
			StorageUsed:    68, // Placeholder — real implementation would query agent.
			StorageFree:    "2.1TB",
		},
		MotionByCamera: motionByCameraData,
		Zones:          zones,
		RecentActivity: recentActivity,
	})
}

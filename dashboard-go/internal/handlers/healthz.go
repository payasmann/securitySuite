package handlers

import (
	"context"
	"log"
	"net/http"
	"time"
)

// startTime records when the process started for uptime calculation.
var startTime = time.Now()

// Healthz handles GET /api/healthz.
// Load-balancer health check: pings the database and returns status with
// uptime and latency metrics. Returns 200 on success or 503 on failure.
func (h *Handlers) Healthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	started := time.Now()

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Check database connectivity with a simple query.
	var one int
	err := h.Pool.QueryRow(ctx, "SELECT 1").Scan(&one)

	latency := time.Since(started)
	uptime := time.Since(startTime).Seconds()
	now := time.Now().UTC().Format(time.RFC3339)

	if err != nil {
		log.Printf("[Healthz] Database ping failed: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status":    "unhealthy",
			"uptime":    uptime,
			"timestamp": now,
			"db":        "disconnected",
			"error":     err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "healthy",
		"uptime":    uptime,
		"timestamp": now,
		"db":        "connected",
		"latencyMs": latency.Milliseconds(),
	})
}

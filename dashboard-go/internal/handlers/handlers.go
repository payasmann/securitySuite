package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"safeguard-dashboard/internal/websocket"
)

// Handlers holds shared dependencies for all HTTP handler methods.
type Handlers struct {
	Pool *pgxpool.Pool
	Hub  *websocket.Hub
}

// New creates a new Handlers instance.
func New(pool *pgxpool.Pool, hub *websocket.Hub) *Handlers {
	return &Handlers{
		Pool: pool,
		Hub:  hub,
	}
}

// ─── JSON Helpers ───────────────────────────────────────

// writeJSON marshals v to JSON and writes it with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[Handler] Failed to write JSON response: %v", err)
	}
}

// writeError writes a standard JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// decodeJSON decodes the request body into dst. Returns false and writes a 400
// error response if decoding fails.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return false
	}
	return true
}

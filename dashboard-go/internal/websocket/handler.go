package websocket

import (
	"log"
	"net/http"

	"github.com/gorilla/websocket"

	"safeguard-dashboard/internal/auth"
)

// upgrader configures the WebSocket handshake with permissive origin checking.
// In production, tighten CheckOrigin to validate against allowed origins.
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// TODO: restrict to specific origins in production.
		return true
	},
}

// ServeWS upgrades an HTTP request to a WebSocket connection, authenticates the
// caller via JWT (from query parameter or session cookie), and registers the
// resulting client with the hub.
//
// Authentication is attempted in order:
//  1. ?token=<jwt> query parameter
//  2. Session cookie (safeguard-session)
//
// If neither source provides a valid JWT the connection is rejected with 401.
func ServeWS(hub *Hub, w http.ResponseWriter, r *http.Request) {
	// ── Authenticate ────────────────────────────────────
	var user *auth.SessionUser
	var err error

	// Try query parameter first (used by WebSocket clients that can't set cookies).
	if tokenStr := r.URL.Query().Get("token"); tokenStr != "" {
		user, err = auth.ValidateToken(tokenStr)
		if err != nil {
			log.Printf("[WS] Invalid token from query param: %v", err)
			http.Error(w, "Unauthorized: invalid token", http.StatusUnauthorized)
			return
		}
	}

	// Fall back to session cookie.
	if user == nil {
		user, err = auth.GetSessionFromRequest(r)
		if err != nil {
			log.Printf("[WS] No valid session: %v", err)
			http.Error(w, "Unauthorized: authentication required", http.StatusUnauthorized)
			return
		}
	}

	// Reject inactive users.
	if !user.Active {
		http.Error(w, "Forbidden: account is inactive", http.StatusForbidden)
		return
	}

	// ── Upgrade ─────────────────────────────────────────
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade failed for %s: %v", user.ID, err)
		return
	}

	client := &Client{
		hub:      hub,
		conn:     conn,
		send:     make(chan []byte, sendBufferSize),
		UserID:   user.ID,
		Role:     user.Role,
		SchoolID: user.SchoolID,
		rooms:    make(map[string]bool),
	}

	hub.register <- client

	// Start read and write pumps in separate goroutines.
	go client.WritePump()
	go client.ReadPump()
}

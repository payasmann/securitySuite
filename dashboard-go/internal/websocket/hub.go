package websocket

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ─── Constants ──────────────────────────────────────────

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 4096

	// Maximum number of queued messages per client.
	sendBufferSize = 256
)

// ─── Client ─────────────────────────────────────────────

// Client represents a single WebSocket connection.
type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte
	UserID   string
	Role     string
	SchoolID string // empty string if no school (ops users)

	mu    sync.Mutex
	rooms map[string]bool
}

// ─── Hub ────────────────────────────────────────────────

// Hub maintains the set of active clients and manages room-based messaging.
type Hub struct {
	// Registered clients.
	clients map[*Client]bool

	// Room-based client grouping. Key is room name, value is set of clients.
	rooms map[string]map[*Client]bool

	// Register requests from clients.
	register chan *Client

	// Unregister requests from clients.
	unregister chan *Client

	// Broadcast messages to a specific room.
	broadcast chan *RoomMessage

	mu sync.RWMutex
}

// RoomMessage carries a message destined for all clients in a room.
type RoomMessage struct {
	Room    string
	Payload []byte
}

// IncomingMessage represents a message received from a client.
type IncomingMessage struct {
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// OutgoingMessage represents a message sent to a client.
type OutgoingMessage struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
}

// NewHub creates a new Hub instance.
func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		rooms:      make(map[string]map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan *RoomMessage, 256),
	}
}

// Run starts the hub's main event loop. This should be launched as a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

			// Auto-join rooms based on user attributes.
			h.autoJoin(client)

			log.Printf("[WS] Connected: %s (%s)", client.UserID, client.Role)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				h.removeClientFromAllRooms(client)
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()

			log.Printf("[WS] Disconnected: %s (%s)", client.UserID, client.Role)

		case msg := <-h.broadcast:
			h.mu.RLock()
			if clients, ok := h.rooms[msg.Room]; ok {
				for client := range clients {
					select {
					case client.send <- msg.Payload:
					default:
						// Client send buffer full; schedule removal.
						go h.removeStaleClient(client)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// ─── Room Management ────────────────────────────────────

// autoJoin adds a client to their default rooms based on role and school.
func (h *Hub) autoJoin(client *Client) {
	// School users join their school room.
	if client.SchoolID != "" {
		h.JoinRoom(client, fmt.Sprintf("school:%s", client.SchoolID))
		log.Printf("[WS] %s auto-joined school:%s", client.UserID, client.SchoolID)
	}

	// Ops users join the ops room.
	if client.Role == "SUPER_ADMIN" || client.Role == "OPS_VIEWER" {
		h.JoinRoom(client, "ops")
		log.Printf("[WS] %s auto-joined ops", client.UserID)
	}
}

// JoinRoom adds a client to a named room.
func (h *Hub) JoinRoom(client *Client, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.rooms[room] == nil {
		h.rooms[room] = make(map[*Client]bool)
	}
	h.rooms[room][client] = true

	client.mu.Lock()
	client.rooms[room] = true
	client.mu.Unlock()
}

// LeaveRoom removes a client from a named room.
func (h *Hub) LeaveRoom(client *Client, room string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if clients, ok := h.rooms[room]; ok {
		delete(clients, client)
		if len(clients) == 0 {
			delete(h.rooms, room)
		}
	}

	client.mu.Lock()
	delete(client.rooms, room)
	client.mu.Unlock()
}

// removeClientFromAllRooms removes a client from every room. Caller must hold h.mu.
func (h *Hub) removeClientFromAllRooms(client *Client) {
	client.mu.Lock()
	rooms := make([]string, 0, len(client.rooms))
	for room := range client.rooms {
		rooms = append(rooms, room)
	}
	client.rooms = make(map[string]bool)
	client.mu.Unlock()

	for _, room := range rooms {
		if clients, ok := h.rooms[room]; ok {
			delete(clients, client)
			if len(clients) == 0 {
				delete(h.rooms, room)
			}
		}
	}
}

// removeStaleClient unregisters a client whose send buffer is full.
func (h *Hub) removeStaleClient(client *Client) {
	h.unregister <- client
	client.conn.Close()
}

// BroadcastToRoom sends a payload to every client in a room.
func (h *Hub) BroadcastToRoom(room string, payload []byte) {
	h.broadcast <- &RoomMessage{
		Room:    room,
		Payload: payload,
	}
}

// ClientCount returns the number of connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// RoomClientCount returns the number of clients in a specific room.
func (h *Hub) RoomClientCount(room string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if clients, ok := h.rooms[room]; ok {
		return len(clients)
	}
	return 0
}

// ─── Client Read/Write Pumps ────────────────────────────

// ReadPump pumps messages from the WebSocket connection to the hub.
// It runs in a per-client goroutine and handles incoming messages.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[WS] Read error for %s: %v", c.UserID, err)
			}
			break
		}

		c.handleMessage(message)
	}
}

// WritePump pumps messages from the hub to the WebSocket connection.
// It runs in a per-client goroutine and handles outgoing messages and pings.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Drain queued messages into the current write frame.
			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte("\n"))
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handleMessage processes an incoming client message and routes it accordingly.
func (c *Client) handleMessage(raw []byte) {
	var msg IncomingMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		log.Printf("[WS] Invalid message from %s: %v", c.UserID, err)
		return
	}

	switch msg.Event {
	case "join:school":
		var schoolID string
		if err := json.Unmarshal(msg.Data, &schoolID); err != nil {
			log.Printf("[WS] Invalid join:school data from %s: %v", c.UserID, err)
			return
		}
		// Only allow joining own school or ops users joining any school.
		if c.Role == "SUPER_ADMIN" || c.Role == "OPS_VIEWER" || c.SchoolID == schoolID {
			room := fmt.Sprintf("school:%s", schoolID)
			c.hub.JoinRoom(c, room)
			log.Printf("[WS] %s manually joined %s", c.UserID, room)
		} else {
			log.Printf("[WS] %s denied join:school %s (role=%s, schoolID=%s)", c.UserID, schoolID, c.Role, c.SchoolID)
		}

	case "join:ops":
		if c.Role == "SUPER_ADMIN" || c.Role == "OPS_VIEWER" {
			c.hub.JoinRoom(c, "ops")
			log.Printf("[WS] %s manually joined ops", c.UserID)
		} else {
			log.Printf("[WS] %s denied join:ops (role=%s)", c.UserID, c.Role)
		}

	default:
		log.Printf("[WS] Unknown event from %s: %s", c.UserID, msg.Event)
	}
}

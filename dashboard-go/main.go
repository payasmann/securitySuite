package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/handlers"
	"safeguard-dashboard/internal/middleware"
	"safeguard-dashboard/internal/websocket"
)

func main() {
	// ── Load .env ───────────────────────────────────────
	if err := godotenv.Load(); err != nil {
		log.Println("[Main] No .env file found, using environment variables")
	}

	// ── Read config ─────────────────────────────────────
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("[Main] DATABASE_URL is required")
	}

	authSecret := os.Getenv("AUTH_SECRET")
	if authSecret == "" {
		log.Fatal("[Main] AUTH_SECRET is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	// REDIS_URL read for future use
	_ = os.Getenv("REDIS_URL")

	// ── Database ────────────────────────────────────────
	pool, err := database.NewPool(databaseURL)
	if err != nil {
		log.Fatalf("[Main] Failed to create database pool: %v", err)
	}
	defer database.Close()
	log.Println("[Main] Database connected")

	// ── Run migration ───────────────────────────────────
	migrationSQL, err := os.ReadFile("migrations/001_init.sql")
	if err != nil {
		log.Printf("[Main] Warning: could not read migration file: %v", err)
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		_, err = pool.Exec(ctx, string(migrationSQL))
		cancel()
		if err != nil {
			log.Printf("[Main] Warning: migration execution error (may already be applied): %v", err)
		} else {
			log.Println("[Main] Migration applied successfully")
		}
	}

	// ── WebSocket hub ───────────────────────────────────
	hub := websocket.NewHub()
	go hub.Run()
	log.Println("[Main] WebSocket hub started")

	// ── Handlers ────────────────────────────────────────
	h := handlers.New(pool, hub)

	// ── Page handlers ───────────────────────────────────
	pages := handlers.NewPageHandlers(pool, hub)

	// ── Router ──────────────────────────────────────────
	mux := http.NewServeMux()

	// ── Static files ────────────────────────────────────
	fs := http.FileServer(http.Dir("static"))
	mux.Handle("/static/", http.StripPrefix("/static/", fs))

	// ── API routes ──────────────────────────────────────

	// Auth (public)
	mux.HandleFunc("POST /api/auth/login", h.Login)
	mux.HandleFunc("POST /api/auth/logout", h.Logout)

	// Health (agent endpoints, authenticated via API key in body/headers)
	mux.HandleFunc("POST /api/health", h.Health)
	mux.HandleFunc("POST /api/v1/health", h.Health)
	mux.HandleFunc("GET /api/healthz", h.Healthz)

	// Motion (agent endpoint, authenticated via API key headers)
	mux.HandleFunc("POST /api/motion", h.Motion)
	mux.HandleFunc("POST /api/v1/motion", h.Motion)

	// Dashboard (protected)
	mux.Handle("GET /api/dashboard/stats", middleware.RequireAuth(http.HandlerFunc(h.DashboardStats)))

	// Cameras (protected)
	mux.Handle("GET /api/cameras", middleware.RequireAuth(http.HandlerFunc(h.ListCameras)))
	mux.Handle("GET /api/cameras/{id}", middleware.RequireAuth(http.HandlerFunc(h.GetCamera)))

	// Alerts (protected)
	mux.Handle("GET /api/alerts", middleware.RequireAuth(http.HandlerFunc(h.ListAlerts)))
	mux.Handle("POST /api/alerts/{id}/resolve", middleware.RequireAuth(http.HandlerFunc(h.ResolveAlert)))

	// Schools (protected)
	mux.Handle("GET /api/schools", middleware.RequireAuth(http.HandlerFunc(h.ListSchools)))
	mux.Handle("GET /api/schools/{id}", middleware.RequireAuth(http.HandlerFunc(h.GetSchool)))
	mux.Handle("PATCH /api/schools/{id}/settings", middleware.RequireAuth(http.HandlerFunc(h.UpdateSchoolSettings)))

	// Users (protected)
	mux.Handle("GET /api/users", middleware.RequireAuth(http.HandlerFunc(h.ListUsers)))
	mux.Handle("POST /api/users", middleware.RequireAuth(http.HandlerFunc(h.CreateUser)))
	mux.Handle("PATCH /api/users/{id}", middleware.RequireAuth(http.HandlerFunc(h.UpdateUser)))
	mux.Handle("DELETE /api/users/{id}", middleware.RequireAuth(http.HandlerFunc(h.DeleteUser)))

	// Streams (protected)
	mux.Handle("GET /api/stream/{cameraId}", middleware.RequireAuth(http.HandlerFunc(h.GetStream)))

	// Recordings (ingest is API-key auth, list/stream are session auth)
	mux.HandleFunc("POST /api/recordings/ingest", h.IngestRecording)
	mux.HandleFunc("POST /api/v1/recordings/ingest", h.IngestRecording)
	mux.Handle("GET /api/recordings/{schoolId}/{cameraId}/{date}", middleware.RequireAuth(http.HandlerFunc(h.ListRecordingSegments)))
	mux.Handle("GET /api/recordings/{schoolId}/{cameraId}/{date}/{segment}", middleware.RequireAuth(http.HandlerFunc(h.StreamRecordingSegment)))

	// WebSocket
	mux.HandleFunc("GET /ws", func(w http.ResponseWriter, r *http.Request) {
		websocket.ServeWS(hub, w, r)
	})

	// ── Page routes (HTML) ──────────────────────────────

	// Login (public)
	mux.HandleFunc("GET /login", pages.LoginPage)

	// Root redirect
	mux.HandleFunc("GET /{$}", pages.RootRedirect)

	// School portal pages (protected)
	mux.Handle("GET /dashboard", middleware.RequireAuth(http.HandlerFunc(pages.SchoolDashboardPage)))
	mux.Handle("GET /cameras", middleware.RequireAuth(http.HandlerFunc(pages.CamerasPage)))
	mux.Handle("GET /alerts", middleware.RequireAuth(http.HandlerFunc(pages.SchoolAlertsPage)))
	mux.Handle("GET /management", middleware.RequireAuth(http.HandlerFunc(pages.ManagementPage)))
	mux.Handle("GET /users", middleware.RequireAuth(http.HandlerFunc(pages.UsersPage)))

	// Ops portal pages (protected)
	mux.Handle("GET /ops/dashboard", middleware.RequireAuth(http.HandlerFunc(pages.OpsDashboardPage)))
	mux.Handle("GET /ops/schools", middleware.RequireAuth(http.HandlerFunc(pages.OpsSchoolsPage)))
	mux.Handle("GET /ops/schools/{id}", middleware.RequireAuth(http.HandlerFunc(pages.OpsSchoolDetailPage)))
	mux.Handle("GET /ops/schools/{id}/settings", middleware.RequireAuth(http.HandlerFunc(pages.OpsSchoolSettingsPage)))
	mux.Handle("GET /ops/alerts", middleware.RequireAuth(http.HandlerFunc(pages.OpsAlertsPage)))
	mux.Handle("GET /ops/users", middleware.RequireAuth(http.HandlerFunc(pages.OpsUsersPage)))

	// ── Middleware chain ────────────────────────────────
	chain := middleware.Chain(
		middleware.Recovery,
		middleware.Logger,
		middleware.CORS,
		middleware.AuthMiddleware,
	)

	handler := chain(mux)

	// ── HTTP server ─────────────────────────────────────
	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// ── Graceful shutdown ───────────────────────────────
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		log.Printf("[Main] Server listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Main] Server error: %v", err)
		}
	}()

	<-done
	log.Println("[Main] Shutting down gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("[Main] Forced shutdown: %v", err)
	}

	log.Println("[Main] Server stopped")
}

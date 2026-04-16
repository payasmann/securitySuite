package main

import (
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
)

// httpClient is a shared HTTP client with sensible timeouts.
var httpClient = &http.Client{
	Timeout: 30 * time.Second,
}

func main() {
	// Load .env file if present (ignore error if missing)
	godotenv.Load()

	cfg := LoadConfig()
	PrintBanner(cfg)

	if cfg.AgentPublicURL == "" {
		fmt.Println("[Agent] WARNING: AGENT_PUBLIC_URL not set — browsers will use cloud proxy fallback for video")
	}

	if cfg.SchoolID == "" || cfg.APIKey == "" {
		fmt.Fprintln(os.Stderr, "ERROR: SCHOOL_ID and API_KEY must be set in environment")
		os.Exit(1)
	}

	// Start health ping (heartbeat to cloud API)
	StartHealthPing(cfg)

	// Start stream bridge manager (MediaMTX process)
	if cfg.MediamtxPath != "" {
		StartStreamBridge(cfg)
	} else {
		fmt.Println("[StreamBridge] MediaMTX path not configured, skipping")
	}

	// Start motion detection listener (ONVIF event subscriptions)
	StartMotionDetect(cfg)

	// Start local recording (after stream bridge is running)
	InitLocalStorage(cfg)

	// Start central NVR sync
	InitCentralSync(cfg)

	fmt.Println("[Agent] All services started\n")

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigCh
	fmt.Printf("\n[Agent] Received %s, shutting down...\n", sig)

	StopMotionDetect()
	StopAllRecordings()
	StopStreamBridge()
	StopCentralSync()

	fmt.Println("[Agent] Shutdown complete")
}

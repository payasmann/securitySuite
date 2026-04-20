# InfoSec — School Security Camera Management

A multi-tenant web platform for centrally managing security cameras across multiple schools. The system consists of a **cloud dashboard** (hosted on your server) and lightweight **on-premises agents** (installed at each school). Video streams flow directly from the agent to browsers via WebRTC — the cloud never touches video data.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [What It Does](#what-it-does)
- [What It Does Not Do](#what-it-does-not-do)
- [Tech Stack](#tech-stack)
- [User Roles and Permissions](#user-roles-and-permissions)
- [Cloud Server Requirements](#cloud-server-requirements)
- [School Agent Requirements](#school-agent-requirements)
- [Environment Variables](#environment-variables)
- [Getting Started (Development)](#getting-started-development)
- [Production Deployment](#production-deployment)
- [Project Structure](#project-structure)

---

## Architecture Overview

```
                          INTERNET
                             |
               +-----------------------------+
               |     Cloud Web Dashboard     |
               |     (security.infoiles.com) |
               |                             |
               |  Next.js + Socket.io        |
               |  PostgreSQL / Redis / S3    |
               +-----------------------------+
                   ^           ^           ^
                   |           |           |
          HTTPS heartbeats + API + Socket.io (no video)
                   |           |           |
          +--------+--+  +----+-----+  +--+--------+
          | School A  |  | School B |  | School C  |
          | Agent     |  | Agent    |  | Agent     |
          | (on-site) |  | (on-site)|  | (on-site) |
          +-----+-----+  +----+----+  +-----+-----+
                |  \           |  \          |  \
          LAN   |   WebRTC    |   WebRTC    |   WebRTC
          cams  |   (WHEP)    |   (WHEP)    |   (WHEP)
                |    ↓        |    ↓        |    ↓
              Browsers    Browsers      Browsers
```

**Two components run separately:**

- **Cloud Dashboard** — The web application, API, and database. Hosted on a single server accessible over the internet. All users (ops team and school staff) access this through a browser. The cloud handles heartbeats, API requests, Socket.io events, and provides authenticated WHEP URLs — but **never proxies or touches video data**.
- **On-Premises Agent** — A lightweight Node.js process installed at each school. Runs on the school's local network, connects to cameras via RTSP, manages video stream bridging through MediaMTX (with programmatically generated configuration), subscribes to ONVIF motion events, optionally records to local disk via FFmpeg, and reports status back to the cloud dashboard via periodic heartbeats. Browsers connect **directly** to the agent's MediaMTX WHEP endpoint for live video over WebRTC.

---

## What It Does

### Cloud Dashboard
- **Multi-school management** — A single dashboard manages cameras, users, and alerts across all enrolled schools. Each school's data is isolated.
- **Live camera monitoring** — View camera grids showing status (online/offline/warning), zone information, and camera details.
- **Live stream viewing** — Watch live camera feeds via direct WebRTC connection to the on-premises agent's MediaMTX WHEP endpoint. The cloud provides authenticated WHEP URLs but does not proxy any video data.
- **Direct stream routing** — The cloud resolves and serves authenticated WHEP URLs to browsers. If the agent has `AGENT_PUBLIC_URL` configured, the public URL is returned; otherwise it falls back to the agent's internal URL. No video passes through the cloud server.
- **Alert system** — Automatic alerts generated when cameras go offline, come back online, or miss heartbeats (stale detection). Alerts can be resolved by authorized users. Real-time alert delivery via WebSockets.
- **Motion events** — Real-time motion event tracking from ONVIF-enabled cameras. Per-camera motion counts are displayed in the dashboard. Auto-generated WARNING alerts are created when excessive motion is detected (5+ events within 60 seconds on a single camera).
- **User management** — Create and manage users with role-based access control. School admins can manage users within their school. Super admins can manage all users across all schools.
- **Real-time updates** — Socket.io delivers live camera status changes, motion events, new alerts, and dashboard statistics to all connected clients without page refresh.
- **Per-school feature flags** — Super admins can enable/disable features per school: local storage, cloud storage, remote access, and live view. Configurable retention days, max cameras, and max users per school.
- **Dashboard statistics** — Overview of total cameras, online/offline counts, alert counts, motion activity, and recent activity.
- **Ops portal** — Dedicated interface for the operations team to oversee all schools, view cross-school alerts, and manage system-wide settings.

### On-Premises Agent
- **Camera health monitoring** — Periodically checks RTSP reachability of each configured camera via TCP connection test and reports status to the cloud.
- **Heartbeat reporting** — Sends periodic POST requests to the cloud API with camera statuses and recording status. The cloud auto-detects stale cameras if heartbeats stop arriving.
- **Stream bridging** — Programmatically generates a MediaMTX configuration from the camera list, including per-camera RTSP source paths with audio passthrough (`audioEncoder: copy`) and WHEP endpoints for direct browser access on port 8889. MediaMTX auto-restarts with exponential backoff if it crashes.
- **Audio passthrough** — Camera microphone audio is passed through to browsers via WebRTC. The generated MediaMTX config sets `audioEncoder: copy` for every camera path. The dashboard provides a per-camera mute/unmute toggle, defaulting to muted.
- **H.265 → H.264 transcoding** — Automatic transcoding for browser compatibility. Uses NVENC hardware encoding (`h264_nvenc`) when an NVIDIA GPU is available, with automatic fallback to software encoding (`libx264` with `ultrafast` preset) when no GPU is detected. NVENC availability is probed at startup via `nvidia-smi`.
- **Direct WebRTC streaming** — Browsers connect directly to the agent's MediaMTX WHEP endpoint (`{agentPublicUrl}/{cameraId}/whep`), bypassing the cloud server entirely for video delivery. This results in zero cloud bandwidth usage for video and minimal latency.
- **Motion detection** — Connects to each camera's ONVIF service and subscribes to motion alarm events (supports `RuleEngine/CellMotionDetector/Motion`, `VideoSource/MotionAlarm`, and other standard ONVIF motion topics). Detected events are reported to the cloud API (`POST /api/motion`) with a 10-second per-camera debounce window. Cameras without ONVIF credentials configured are gracefully skipped — RTSP streaming and health monitoring continue regardless.
- **Local recording** — FFmpeg records each camera's RTSP stream to local disk in 10-minute MP4 segments using stream copy (`-c copy`, no transcoding overhead). Segments are organized by camera ID and date (`{storagePath}/{cameraId}/{YYYY-MM-DD}/segment_{HH-MM-SS}.mp4`). Recording processes auto-restart on crash with exponential backoff (up to 5 retries). Daily retention cleanup runs at 2 AM, deleting directories older than the configured retention period. Recording status and disk usage are reported in heartbeats.

---

## What It Does Not Do

- **No AI/ML video analysis** — There is no object detection, facial recognition, person counting, or any computer vision processing. Motion detection relies on camera-side ONVIF events, not frame analysis.
- **No cloud video storage** — S3/R2 integration exists for configuration but no recording upload pipeline is implemented. Recordings are stored locally at each school's agent.
- **No mobile app** — The dashboard is a web application only. It is responsive but there is no native iOS/Android app.
- **No camera PTZ control** — Despite cameras having a type field (PTZ, Dome, Bullet, Wide), there is no pan-tilt-zoom control interface.
- **No automatic camera discovery** — Cameras must be manually configured with their RTSP URLs. ONVIF is used for motion event subscription but **not** for camera discovery or network scanning.
- **No multi-factor authentication** — Authentication uses email/password with bcrypt hashing and JWT sessions. There is no MFA, SSO, or OAuth integration.

---

## Tech Stack

| Layer             | Technology                                            |
|-------------------|-------------------------------------------------------|
| Framework         | Next.js 14.2 (App Router)                             |
| Language          | TypeScript 5.x                                        |
| UI                | React 18, Tailwind CSS 3.4                            |
| Database          | PostgreSQL (via Prisma ORM 7.6)                       |
| Authentication    | NextAuth v5 (Credentials provider, JWT sessions)      |
| Real-time         | Socket.io 4.8 (WebSocket + HTTP polling fallback)     |
| Caching           | Redis (via ioredis 5.10)                              |
| Object Storage    | S3-compatible (AWS SDK v3, configured for Cloudflare R2) |
| Validation        | Zod 4.3                                               |
| Agent Runtime     | Node.js + tsx                                         |
| Stream Bridge     | MediaMTX (external binary, managed as child process)  |
| Video Encoder     | NVENC (h264_nvenc) / libx264 software fallback        |
| Recording         | FFmpeg (segment recording, copy codec)                |
| Camera Events     | ONVIF (onvif npm package, motion event subscription)  |

---

## User Roles and Permissions

| Permission                  | SUPER_ADMIN | OPS_VIEWER | SCHOOL_ADMIN | SCHOOL_VIEWER |
|-----------------------------|:-----------:|:----------:|:------------:|:-------------:|
| Access ops portal           | Yes         | Yes        | No           | No            |
| Access school portal        | Yes         | No         | Yes          | Yes           |
| Manage schools              | Yes         | No         | No           | No            |
| View all schools            | Yes         | Yes        | No           | No            |
| Edit feature flags          | Yes         | No         | No           | No            |
| View cameras                | Yes         | Yes        | Yes          | Yes           |
| Manage cameras              | Yes         | No         | No           | No            |
| View live feeds             | Yes         | No         | Yes          | Yes           |
| View alerts                 | Yes         | Yes        | Yes          | Yes           |
| Resolve alerts              | Yes         | No         | Yes          | No            |
| View cross-school alerts    | Yes         | Yes        | No           | No            |
| Manage users (own school)   | Yes         | No         | Yes          | No            |
| Manage users (all schools)  | Yes         | No         | No           | No            |

- **SUPER_ADMIN** — Full system access. Can manage all schools, users, cameras, and feature flags.
- **OPS_VIEWER** — Read-only operations view. Can see all schools and alerts but cannot make changes or view live feeds.
- **SCHOOL_ADMIN** — Manages their own school. Can manage users within their school and resolve alerts. Cannot modify camera configurations.
- **SCHOOL_VIEWER** — View-only access to their school's cameras, alerts, and dashboard.

---

## Cloud Server Requirements

The cloud dashboard runs on a server you control. All users and all school agents connect to this server. Since video is streamed directly from agents to browsers, the cloud server does **not** need bandwidth for video.

### Hardware

| Component | Minimum    | Recommended   | Notes                                      |
|-----------|------------|---------------|---------------------------------------------|
| CPU       | 2 cores    | 4 cores       | Node.js is single-threaded but PostgreSQL and Redis benefit from extra cores |
| RAM       | 2 GB       | 4 GB          | See memory breakdown below                  |
| Storage   | 20 GB SSD  | 50+ GB SSD    | Database growth depends on alert/event volume |
| Network   | 10 Mbps    | 50+ Mbps      | Primarily API traffic and Socket.io events — no video bandwidth |

### Expected Memory Usage

| Component          | Idle / Light Use | Under Load     |
|--------------------|------------------|----------------|
| Next.js (Node.js)  | 150 - 300 MB     | 400 - 600 MB   |
| PostgreSQL         | 50 - 100 MB      | 200 - 500 MB   |
| Redis              | 10 - 30 MB       | 50 - 100 MB    |
| **Total**          | **~200 - 430 MB**| **~650 MB - 1.2 GB** |

### Software

| Dependency   | Version   | Required |
|-------------|-----------|----------|
| Node.js     | 18+       | Yes      |
| PostgreSQL  | 14+       | Yes      |
| Redis       | 6+        | Yes      |
| npm         | 9+        | Yes      |

### External Services

| Service              | Purpose                        | Required |
|----------------------|--------------------------------|----------|
| S3-compatible storage (Cloudflare R2, AWS S3) | Alert snapshots, future cloud recordings | Optional (not actively used yet) |

---

## School Agent Requirements

Each school runs a lightweight agent on a machine connected to the camera network. The agent manages video stream bridging (with optional H.265→H.264 transcoding for browser compatibility), serves WebRTC streams directly to browsers via WHEP, subscribes to ONVIF camera motion events, optionally records streams locally via FFmpeg, and reports camera health to the cloud.

### Hardware

| Component | Minimum        | Recommended    | Notes                                      |
|-----------|----------------|----------------|---------------------------------------------|
| CPU       | 2 cores        | 4 cores        | Software transcoding uses CPU if no GPU available |
| RAM       | 1 GB           | 2 - 4 GB       | Scales with camera count (see below)        |
| Storage   | 8 GB           | 256+ GB SSD    | Only matters if local recording is enabled  |
| GPU       | Not needed     | Recommended (NVIDIA with NVENC) | Required for efficient H.265→H.264 transcoding; software fallback available |
| Network   | 100 Mbps LAN   | Gigabit LAN    | Must reach cameras on LAN + internet access to cloud server |

### RAM Scaling by Camera Count

| Cameras | Estimated Agent RAM |
|---------|---------------------|
| 5 - 10  | 200 - 400 MB        |
| 20 - 30 | 400 - 800 MB        |
| 50+     | 1 - 2 GB            |
| 100+    | 2 - 4 GB            |

### Bandwidth Considerations

Each camera stream is typically 2 - 8 Mbps at 1080p.

| Cameras | LAN Bandwidth (ingest from cameras) | Internet Upload (per remote viewer) |
|---------|-------------------------------------|--------------------------------------|
| 10      | ~40 Mbps                            | ~4 - 8 Mbps per stream viewed        |
| 25      | ~100 Mbps                           | ~4 - 8 Mbps per stream viewed        |
| 50      | ~200 Mbps                           | ~4 - 8 Mbps per stream viewed        |
| 100     | ~400 Mbps                           | ~4 - 8 Mbps per stream viewed        |

**The school's internet upload speed limits how many streams can be viewed remotely at the same time.** A school with 20 Mbps upload can support roughly 3 - 5 concurrent remote 1080p viewers. With direct WebRTC, each browser viewer connects directly to the agent — the cloud server adds no bandwidth overhead.

### Supported Operating Systems

| OS                         | Supported | Notes                                     |
|----------------------------|-----------|-------------------------------------------|
| Linux (Ubuntu, Debian, etc.) | Yes     | Recommended for always-on deployments    |
| Windows 10/11, Server       | Yes     | Node.js and MediaMTX both have Windows builds |
| macOS                        | Yes     | Suitable for testing                     |

### Software

| Dependency | Version | Required |
|-----------|---------|----------|
| Node.js   | 18+     | Yes      |
| MediaMTX  | Latest  | Yes (pre-built binary, no compilation needed) |
| FFmpeg    | 4+      | Only if local recording is enabled  |

### Suitable Hardware Examples

| Device                          | Approximate Cost | Capacity             |
|---------------------------------|------------------|----------------------|
| Raspberry Pi 4/5 (4 GB)        | $50 - 80         | Up to 10 - 15 cameras |
| Mini PC (Intel N100 or similar) | $100 - 150       | 20+ cameras           |
| Old desktop or laptop           | Free             | More than sufficient  |
| Existing NVR or server          | Already available | Install Node.js on it |

### GPU Transcoding (Optional)

Many IP cameras (especially CP Plus 4K/5MP models) output H.265 (HEVC). Chrome, Edge, and Android browsers do not support H.265 in WebRTC, which prevents live viewing. The agent can transcode H.265 streams to H.264 in real-time to ensure browser compatibility.

**NVENC hardware transcoding** is the recommended approach. It offloads encoding to the NVIDIA GPU, keeping CPU usage low even with many cameras.

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `TRANSCODE_ENABLED` | `true`  | Enable H.265→H.264 transcoding. Set to `false` for passthrough (cameras must output H.264). |
| `NVENC_ENABLED`      | `true`  | Allow NVENC hardware encoding. Set to `false` to force software encoding (libx264). |
| `TRANSCODE_BITRATE`  | `4000`  | Target video bitrate in kbps. Adjust based on resolution and available bandwidth. |

**Encoder selection logic:**

1. If `TRANSCODE_ENABLED=false` — streams pass through as-is (`videoEncoder: copy`)
2. If `TRANSCODE_ENABLED=true` and NVENC is available — uses `h264_nvenc` (GPU hardware encoding)
3. If `TRANSCODE_ENABLED=true` and NVENC is not available — falls back to `libx264` (CPU software encoding with `ultrafast` preset)

NVENC availability is detected automatically at agent startup by running `nvidia-smi`.

**Supported NVIDIA GPUs:**

| Category     | Minimum                 | Examples                                    |
|-------------|-------------------------|---------------------------------------------|
| Consumer    | GTX 1650 or newer       | GTX 1650, RTX 2060, RTX 3060, RTX 4060     |
| Workstation | Quadro T400 or newer    | Quadro T400, Quadro RTX 4000, RTX A2000+    |
| Data Center | Tesla T4 or newer       | Tesla T4, A10, A30, L4                      |

**Bitrate recommendations:**

| Resolution | Suggested Bitrate | Notes |
|-----------|-------------------|-------|
| 1080p     | 3000 - 4000 kbps  | Good quality for monitoring |
| 4K (2160p)| 6000 - 8000 kbps  | Higher bitrate needed for detail |
| 5MP       | 4000 - 6000 kbps  | Balance between quality and bandwidth |

> **Note:** Software fallback (`libx264 ultrafast`) works but uses significantly more CPU. A single 4K stream may consume an entire CPU core. For deployments with more than a few cameras, an NVIDIA GPU is strongly recommended.

### Network Requirements

- The agent machine must be on the **same local network** as the security cameras (or able to reach their RTSP endpoints).
- The agent machine must have **outbound internet access** (HTTPS) to reach the cloud dashboard for heartbeats and API calls.
- If `AGENT_PUBLIC_URL` is configured for direct WebRTC streaming, **port 8889 must be accessible from the internet** (or placed behind a reverse proxy). This is the MediaMTX WHEP endpoint that browsers connect to directly.
- If `AGENT_PUBLIC_URL` is **not** configured, the agent only needs outbound internet access — no inbound ports need to be opened on the school's firewall. The cloud will return the agent's internal URL, which only works for browsers on the same local network.

---

## Environment Variables

### Cloud Dashboard (`.env`)

```env
# Database (PostgreSQL)
DATABASE_URL="postgresql://user:password@localhost:5432/infosec?schema=public"

# NextAuth
NEXTAUTH_URL="https://security.infoiles.com"
NEXTAUTH_SECRET="generate-a-random-secret"
AUTH_SECRET="same-as-nextauth-secret"

# Redis
REDIS_URL="redis://localhost:6379"

# S3 / Cloudflare R2 (optional — not actively used yet)
S3_ENDPOINT=""
S3_ACCESS_KEY=""
S3_SECRET_KEY=""
S3_BUCKET=""
S3_REGION="auto"
```

### School Agent (`agent/.env`)

```env
# Cloud dashboard URL
API_URL="https://security.infoiles.com"

# School identification (from database)
SCHOOL_ID="cuid-from-database"
API_KEY="shared-secret-for-this-school"

# MediaMTX
MEDIAMTX_PATH="/usr/local/bin/mediamtx"
MEDIAMTX_CONFIG="/etc/mediamtx/mediamtx.yml"

# Cameras (comma-separated)
# Format: cameraId:rtspUrl[:onvifUser:onvifPassword]
# ONVIF credentials are optional — cameras without them skip motion detection
CAMERAS="CAM-01:rtsp://192.168.1.100:554/stream1:admin:password123,CAM-02:rtsp://192.168.1.101:554/stream1"

# Direct WebRTC (browser connects directly to agent, bypasses cloud for video)
# Set this to the agent's publicly reachable URL if remote viewers need access
AGENT_PUBLIC_URL="https://stream.myschool.example.com:8889"

# H.265 → H.264 transcoding
TRANSCODE_ENABLED="true"
NVENC_ENABLED="true"
TRANSCODE_BITRATE="4000"

# FFmpeg recording
FFMPEG_PATH="ffmpeg"
LOCAL_STORAGE_PATH="./recordings"
LOCAL_STORAGE_ENABLED="false"
RETENTION_DAYS="14"

# Heartbeat interval in milliseconds (default: 30000)
HEARTBEAT_INTERVAL="30000"
```

---

## Getting Started (Development)

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ running locally
- Redis 6+ running locally

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in values
cp .env.example .env

# 3. Push the database schema
npx prisma db push

# 4. Seed the database with sample data (3 schools, 6 users, 19 cameras)
npx prisma db seed

# 5. Start the development server
npm run dev
```

The dashboard will be available at `http://localhost:3000`.

### Running the Agent (Development)

```bash
cd agent

# Install agent dependencies
npm install

# Create agent .env and configure
# Then start in watch mode
npm run dev
```

---

## Production Deployment

### Cloud Dashboard

```bash
# Build for production
npm run build

# Start production server (uses server.ts with Socket.io)
PORT=3001 npm run start
```

Use a process manager to keep it running:

```bash
npm install -g pm2
pm2 start npm --name "security-suite" -- run start
pm2 save
pm2 startup
```

Place behind a reverse proxy (Apache or Nginx) with HTTPS and WebSocket support.

### School Agent

```bash
cd agent
npm install
npm run start
```

Use PM2 or systemd to keep the agent running permanently at the school.

---

## Project Structure

```
securitySuite/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Login page
│   ├── (ops)/                    # Ops portal (SUPER_ADMIN, OPS_VIEWER)
│   │   └── ops/
│   │       ├── dashboard/        # Cross-school overview
│   │       ├── schools/          # School management + settings
│   │       ├── alerts/           # Cross-school alerts
│   │       └── users/            # User management
│   ├── (school)/                 # School portal (SCHOOL_ADMIN, SCHOOL_VIEWER)
│   │   ├── dashboard/            # School dashboard
│   │   ├── cameras/              # Camera grid with live feeds
│   │   ├── alerts/               # School alerts
│   │   ├── management/           # Camera management table
│   │   └── users/                # School user management
│   └── api/                      # REST API routes
│       ├── auth/                 # NextAuth endpoints
│       ├── health/               # Agent heartbeat endpoint
│       ├── cameras/              # Camera CRUD
│       ├── alerts/               # Alert CRUD + resolve
│       ├── users/                # User CRUD
│       ├── schools/              # School CRUD + settings
│       ├── dashboard/stats/      # Dashboard statistics
│       ├── motion/               # Motion event receiver (from agent ONVIF events)
│       └── stream/[cameraId]/    # Stream URL provider (direct WebRTC WHEP)
├── agent/                        # On-premises agent (separate package)
│   ├── index.ts                  # Entry point + configuration
│   ├── healthPing.ts             # Heartbeat to cloud (RTSP reachability checks)
│   ├── streamBridge.ts           # MediaMTX process manager (programmatic config generation)
│   ├── motionDetect.ts           # ONVIF motion event subscription + cloud reporting
│   ├── storage.ts                # FFmpeg local recording (segmented MP4, retention cleanup)
│   └── mediamtx.yml              # Reference config template (actual config is generated)
├── components/                   # React components
│   ├── dashboard/                # StatCard, MotionBars, ZoneStatus, RecentActivity
│   ├── cameras/                  # CameraGrid, CameraCell, LiveFeed
│   ├── alerts/                   # AlertsList, AlertItem
│   ├── users/                    # UserManagement
│   ├── management/               # CameraTable
│   ├── layout/                   # Sidebar, Topbar (school + ops variants)
│   └── ui/                       # Skeleton, StatusPill, ErrorBoundary
├── hooks/                        # React hooks (useSocket, useCameraStatus)
├── lib/                          # Core libraries
│   ├── auth.ts                   # NextAuth configuration
│   ├── api-auth.ts               # API route auth helpers
│   ├── permissions.ts            # RBAC permission system
│   ├── feature-flags.ts          # Per-school feature flags (Redis-cached)
│   ├── db.ts                     # Prisma client singleton
│   ├── redis.ts                  # Redis client singleton
│   └── socket.ts                 # Socket.io server + emit helpers
├── prisma/
│   ├── schema.prisma             # Database schema (6 models)
│   └── seed.ts                   # Seed data
├── server.ts                     # Custom HTTP server (Next.js + Socket.io)
├── middleware.ts                  # Auth + RBAC route middleware
└── tailwind.config.ts            # Dark theme configuration
```

---

## Database Schema

The database contains 6 models:

- **School** — Tenant entity with feature flags and limits (max cameras, max users, retention days)
- **User** — Email/password auth with role assignment, optionally scoped to a school
- **Camera** — RTSP camera with zone, type, resolution, and status tracking
- **Alert** — System-generated alerts (critical/warning/info) linked to cameras and schools
- **MotionEvent** — Motion detection records with timestamps and camera association
- **StreamBridge** — Per-school agent connection info (internal/public URLs, API key, online status)

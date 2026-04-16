# SAFEGUARD — Complete Setup & Operations Guide

Complete instructions for deploying, operating, and maintaining the SAFEGUARD security camera platform.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Company Server Setup (Cloud Dashboard)](#3-company-server-setup-cloud-dashboard)
4. [School Server Setup (On-Premises Agent)](#4-school-server-setup-on-premises-agent)
5. [Connecting Cameras](#5-connecting-cameras)
6. [Operations Guide](#6-operations-guide)
7. [Settings & Configuration](#7-settings--configuration)
8. [User Management](#8-user-management)
9. [Alerts & Monitoring](#9-alerts--monitoring)
10. [Live Viewing](#10-live-viewing)
11. [Recordings](#11-recordings)
12. [Updating the System](#12-updating-the-system)
13. [Backup & Recovery](#13-backup--recovery)
14. [Troubleshooting](#14-troubleshooting)
15. [CI/CD & Development](#15-cicd--development)
16. [API Reference (Agent Endpoints)](#16-api-reference-agent-endpoints)
17. [API Reference (Dashboard Endpoints)](#17-api-reference-dashboard-endpoints)
18. [Go Alternatives](#18-go-alternatives)

---

## 1. Architecture Overview

SAFEGUARD is a multi-tenant security camera platform with two components:

```
                        INTERNET
                           |
             +─────────────────────────────+
             │     Company Server          │
             │  (Cloud Dashboard)          │
             │  Next.js + Socket.io        │
             │  PostgreSQL / Redis         │
             +─────────────────────────────+
                 ^           ^           ^
                 │           │           │
        HTTPS (heartbeats + API + Socket.io) — no video
                 │           │           │
        +────────+──+  +────+─────+  +──+────────+
        │ School A  │  │ School B │  │ School C  │
        │ Agent     │  │ Agent    │  │ Agent     │
        +─────+─────+  +────+────+  +─────+─────+
              │  \           │  \          │  \
        LAN   │   WebRTC    │   WebRTC    │   WebRTC
        cams  │   (WHEP)    │   (WHEP)    │   (WHEP)
              │    ↓        │    ↓        │    ↓
            Browsers    Browsers      Browsers
```

**Key design principle:** Video never passes through the cloud. It flows directly from on-premises agents to viewers' browsers via WebRTC.

**Components:**
- **Company Server** — Central management dashboard, authentication, alerting, real-time status. Hosted at your domain (e.g., `security.infoiles.com`).
- **School Agent** — Lightweight Node.js process at each school. Bridges cameras to browsers, monitors health, detects motion, records locally.

---

## 2. Prerequisites

### Company Server (Cloud Dashboard)

| Requirement | Minimum |
|---|---|
| Node.js | 18+ |
| npm | 9+ |
| PostgreSQL | 14+ |
| Redis | 6+ |
| CPU | 2-4 cores |
| RAM | 2-4 GB |
| Disk | 20-50 GB SSD |
| Network | 10-50 Mbps, public HTTPS |

### School Agent (Per School)

| Requirement | Minimum |
|---|---|
| Node.js | 18+ |
| MediaMTX | Latest release binary |
| FFmpeg | 4+ (only if recording enabled) |
| NVIDIA GPU + drivers | Optional (for H.265→H.264 hardware transcoding) |
| CPU | 2-4 cores |
| RAM | 1-4 GB |
| Network | LAN access to cameras, outbound HTTPS to cloud |
| Port 8889 | Publicly accessible (if remote viewing needed) |

---

## 3. Company Server Setup (Cloud Dashboard)

### 3.1 Clone and Install

```bash
git clone https://github.com/payasmann/securitySuite.git
cd securitySuite
npm install
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install
```

### 3.2 Create the Database
sudo apt update && sudo apt install -y postgresql postgresql-contrib

```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Inside psql:
CREATE DATABASE infosec;
CREATE USER infosec_user WITH ENCRYPTED PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE infosec TO infosec_user;
\q
```

### 3.3 Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# ── Required ──────────────────────────────────────────────

# PostgreSQL connection string
DATABASE_URL="postgresql://infosec_user:your-secure-password@localhost:5432/infosec?schema=public"

# Public URL of the dashboard (used for auth callbacks)
NEXTAUTH_URL="https://security.yourdomain.com"

# Secrets — generate with: openssl rand -base64 32
NEXTAUTH_SECRET="your-random-secret-here"
AUTH_SECRET="your-random-auth-secret-here"

# Redis connection
REDIS_URL="redis://localhost:6379"

# ── Optional ──────────────────────────────────────────────

# S3/R2 storage (not actively used yet)
# S3_ENDPOINT=""
# S3_ACCESS_KEY=""
# S3_SECRET_KEY=""
# S3_BUCKET=""
# S3_REGION="auto"

# Central NVR recording ingest (for multi-site recording aggregation)
# CENTRAL_INGEST_ENABLED=true
# CENTRAL_INGEST_API_KEY=your-ingest-api-key
# CENTRAL_STORAGE_PATH=./central-recordings
```

### 3.4 Initialize the Database

```bash
# Create all tables via migration
npx prisma migrate deploy

# Generate the Prisma client
npx prisma generate

# (Optional) Seed with demo data — 3 schools, 6 users, 19 cameras
# WARNING: This deletes all existing data. Do NOT run in production.
npm run db:seed
```

### 3.5 Build and Start

**Development:**

```bash
npm run dev
# Dashboard available at http://localhost:3000
```

**Production:**

```bash
# Build Next.js
npm run build

# Start with PM2 (recommended)
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # enables auto-start on reboot

# Or start directly:
NODE_ENV=production PORT=3001 npm run start
```

### 3.6 Verify the Server

```bash
# Health check
curl -s http://localhost:3001/api/healthz | jq .

# Expected response:
# {
#   "status": "healthy",
#   "uptime": 12.345,
#   "timestamp": "2026-04-14T12:00:00.000Z",
#   "db": "connected",
#   "latencyMs": 5
# }
```

### 3.7 Default Login Accounts (Seed Data Only)

If you ran `npm run db:seed`, these accounts are available (password: `password123` for all):

| Email | Role | School |
|---|---|---|
| `admin@infosec.app` | SUPER_ADMIN | None (company-wide) |
| `ops@infosec.app` | OPS_VIEWER | None (company-wide) |
| `admin@willowdale.edu` | SCHOOL_ADMIN | Willowdale Secondary |
| `viewer@willowdale.edu` | SCHOOL_VIEWER | Willowdale Secondary |
| `admin@riverside.edu` | SCHOOL_ADMIN | Riverside Elementary |
| `admin@oakwood.edu` | SCHOOL_ADMIN | Oakwood Academy |

**IMPORTANT:** Change all default passwords immediately in production.

---

## 4. School Server Setup (On-Premises Agent)

Each school site needs its own agent instance. The agent runs on a machine at the school with LAN access to the cameras.

### 4.1 Register the School in the Cloud

Schools must be registered in the cloud database before the agent can connect. There is no web UI for creating schools — use Prisma Studio.

**On the company server:**

```bash
npx prisma studio
# Opens a web UI at http://localhost:5555
```

**Step 1 — Create a School record:**

In Prisma Studio, open the `School` table and add a new record:

| Field | Example | Notes |
|---|---|---|
| `name` | `Willowdale Secondary School` | Display name |
| `slug` | `willowdale` | URL-friendly identifier (unique) |
| `address` | `123 Willowdale Ave, Toronto, ON` | Physical address |
| `ipRange` | `192.168.1.0/24` | School LAN CIDR (for on-prem access gating) |
| `localStorageEnabled` | `true` | Enable local recording |
| `cloudStorageEnabled` | `false` | Cloud storage (not yet implemented) |
| `remoteAccessEnabled` | `true` | Allow viewing from outside school LAN |
| `localViewEnabled` | `true` | Enable live viewing |
| `retentionDays` | `14` | Days to keep recordings |
| `maxCameras` | `16` | Maximum cameras for this school |
| `maxUsers` | `10` | Maximum user accounts for this school |

Save the record and **note the generated `id`** (CUID format like `clx1abc...`).

**Step 2 — Create a StreamBridge record:**

Generate an API key and its bcrypt hash:

```bash
# Generate a random API key
openssl rand -hex 24
# Example output: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6

# Hash it with bcrypt (save the plaintext key — you'll need it for the agent)
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6', 12).then(h => console.log(h))"
```

In Prisma Studio, open the `StreamBridge` table and add a new record:

| Field | Value | Notes |
|---|---|---|
| `schoolId` | (the school CUID from Step 1) | Links to the school |
| `internalUrl` | `http://192.168.1.100:8889` | Agent's LAN address + MediaMTX port |
| `publicUrl` | `https://stream.willowdale.example.com` | Public URL (or leave empty — agent will report it) |
| `apiKey` | (the bcrypt hash from above) | **Only store the hash, never plaintext** |

**Step 3 — Create Camera records:**

For each camera at the school, add a record to the `Camera` table:

| Field | Example | Notes |
|---|---|---|
| `cameraId` | `CAM-01` | Display ID — must match the agent's CAMERAS env var |
| `name` | `Main Entrance` | Human-readable name |
| `zone` | `Entry` | Zone category: `Entry`, `Indoor`, `Outdoor`, `Parking` |
| `type` | `Dome` | Camera type: `PTZ`, `Dome`, `Bullet`, `Wide` |
| `resolution` | `4K` | Resolution: `4K`, `1080p`, `720p` |
| `rtspUrl` | `rtsp://192.168.1.101:554/stream1` | RTSP stream URL on the LAN |
| `schoolId` | (the school CUID) | Links to the school |

**Step 4 — Create user accounts for school staff:**

Add records to the `User` table:

```bash
# Hash the initial password
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('initial-password-123', 12).then(h => console.log(h))"
```

| Field | Example | Notes |
|---|---|---|
| `email` | `admin@willowdale.edu` | Must be unique across all users |
| `name` | `Sarah Chen` | Display name |
| `password` | (bcrypt hash) | **Never store plaintext** |
| `role` | `SCHOOL_ADMIN` | `SCHOOL_ADMIN` or `SCHOOL_VIEWER` |
| `schoolId` | (the school CUID) | Required for school-level roles |

### 4.2 Install the Agent

On the school's agent machine:

```bash
git clone https://github.com/payasmann/securitySuite.git
cd securitySuite/agent
npm install
```

### 4.3 Install MediaMTX

Download the MediaMTX binary for your platform from [https://github.com/bluenviron/mediamtx/releases](https://github.com/bluenviron/mediamtx/releases):

```bash
# Example for Linux amd64
wget https://github.com/bluenviron/mediamtx/releases/latest/download/mediamtx_vX.X.X_linux_amd64.tar.gz
tar -xzf mediamtx_*.tar.gz
sudo mv mediamtx /usr/local/bin/
```

### 4.4 Install FFmpeg (If Recording Enabled)

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Verify
ffmpeg -version
```

### 4.5 Configure the Agent

```bash
cp .env.example .env
```

Edit `agent/.env`:

```env
# ── Required ──────────────────────────────────────────────

# Cloud dashboard URL
API_URL=https://security.yourdomain.com

# School CUID from the cloud database (from Step 4.1)
SCHOOL_ID=clx1abc123def456

# Plaintext API key (must match the bcrypt hash in StreamBridge)
API_KEY=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6

# ── Camera Configuration ─────────────────────────────────
# Format: cameraId:rtspUrl[:onvifUser:onvifPassword]
# Multiple cameras separated by commas
# Camera IDs MUST match the cameraId values in the cloud database
CAMERAS=CAM-01:rtsp://192.168.1.101:554/stream1:admin:pass123,CAM-02:rtsp://192.168.1.102:554/stream1,CAM-03:rtsp://192.168.1.103:554/stream1:admin:pass123

# ── MediaMTX ─────────────────────────────────────────────
MEDIAMTX_PATH=/usr/local/bin/mediamtx
MEDIAMTX_CONFIG=./mediamtx.yml

# ── Transcoding ──────────────────────────────────────────
# H.265→H.264 transcoding for WebRTC browser compatibility
TRANSCODE_ENABLED=true
# Allow NVIDIA GPU hardware encoding (auto-detected)
NVENC_ENABLED=true
# Target video bitrate in kbps
TRANSCODE_BITRATE=4000

# ── Local Recording ──────────────────────────────────────
LOCAL_STORAGE_ENABLED=true
LOCAL_STORAGE_PATH=./recordings
FFMPEG_PATH=ffmpeg
RETENTION_DAYS=14

# ── Network ──────────────────────────────────────────────
# Public URL for direct browser-to-agent WebRTC (bypasses cloud)
# MUST be publicly accessible on port 8889
AGENT_PUBLIC_URL=https://stream.willowdale.example.com

# Heartbeat interval (milliseconds)
HEARTBEAT_INTERVAL=30000

# ── Central NVR Sync (Optional) ──────────────────────────
# Upload local recordings to a central NVR server
# CENTRAL_SERVER_URL=https://central-nvr.example.com
# CENTRAL_SERVER_API_KEY=your-central-api-key
```

### 4.6 Start the Agent

**Development:**

```bash
npm run dev
```

**Production:**

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 4.7 Verify the Agent

After starting, the agent should:

1. Print startup configuration to the console
2. Send its first heartbeat to the cloud within seconds
3. Start MediaMTX and begin ingesting camera streams
4. Subscribe to ONVIF motion events (for cameras with credentials)
5. Begin recording (if `LOCAL_STORAGE_ENABLED=true`)

**Check agent logs:**

```bash
pm2 logs school-agent
```

**On the cloud dashboard:**
- Log in as SUPER_ADMIN
- Navigate to Ops Dashboard → Schools
- The school should show a green "online" bridge status
- Cameras should show ONLINE within 30-90 seconds

---

## 5. Connecting Cameras

### 5.1 Camera Requirements

| Feature | Required | Protocol |
|---|---|---|
| RTSP streaming | Yes | RTSP (port 554) |
| ONVIF event support | Optional (enables motion detection) | ONVIF (port 80) |
| LAN accessibility | Yes | Must be reachable from the agent machine |

### 5.2 Camera Configuration Format

In the agent's `CAMERAS` environment variable:

```
cameraId:rtspUrl[:onvifUser:onvifPassword]
```

- **`cameraId`** — Display identifier (e.g., `CAM-01`). **Must match** the `cameraId` in the cloud database.
- **`rtspUrl`** — The camera's RTSP stream URL on the LAN.
- **`onvifUser` / `onvifPassword`** — Optional. ONVIF credentials for motion detection. Cameras without these are still streamed and recorded — motion detection is simply skipped.

**Examples:**

```bash
# Single camera, no ONVIF
CAMERAS=CAM-01:rtsp://192.168.1.100:554/stream1

# Multiple cameras, mixed ONVIF support
CAMERAS=CAM-01:rtsp://192.168.1.100:554/stream1:admin:password,CAM-02:rtsp://192.168.1.101:554/stream1,CAM-03:rtsp://192.168.1.102:554/stream1:admin:password
```

### 5.3 Common Camera RTSP URL Patterns

| Brand | Typical RTSP URL |
|---|---|
| Hikvision | `rtsp://{ip}:554/Streaming/Channels/101` |
| Dahua | `rtsp://{ip}:554/cam/realmonitor?channel=1&subtype=0` |
| Reolink | `rtsp://{ip}:554/h264Preview_01_main` |
| Amcrest | `rtsp://{ip}:554/cam/realmonitor?channel=1&subtype=0` |
| Generic ONVIF | `rtsp://{ip}:554/stream1` |

### 5.4 What Happens After Connecting

1. **Stream Bridge** — MediaMTX ingests each camera's RTSP and serves it as WebRTC/WHEP on port 8889. GPU transcoding (H.265→H.264) is auto-detected; falls back to CPU `libx264 ultrafast`.
2. **Health Monitoring** — Agent tests RTSP reachability via TCP every heartbeat (30s default). Cameras unreachable for >90s are marked OFFLINE and generate a CRITICAL alert.
3. **Motion Detection** — If ONVIF credentials are provided, the agent subscribes to motion alarm events. 5+ motion events from one camera within 60 seconds triggers a WARNING alert. Per-camera 10-second debounce prevents spam.
4. **Local Recording** — FFmpeg records each stream in 10-minute MP4 segments to `{storagePath}/{cameraId}/{YYYY-MM-DD}/segment_{HH-MM-SS}.mp4`. Old recordings are deleted daily at 2:00 AM based on `RETENTION_DAYS`.
5. **Live Viewing** — Users open the dashboard, browser requests a WHEP URL from the cloud (`/api/stream/[cameraId]`), then connects **directly** to the agent's MediaMTX — video never touches the cloud.

### 5.5 Network Requirements

| Port | Protocol | Direction | Purpose |
|---|---|---|---|
| 554 | TCP | Agent → Camera | RTSP video ingest |
| 80 | TCP | Agent → Camera | ONVIF motion events |
| 8889 | TCP | Browser → Agent | WebRTC/WHEP live viewing |
| 8554 | TCP | Internal only | MediaMTX RTSP server |
| 443 | TCP | Agent → Cloud | Heartbeats, motion reports, API calls |

**Firewall rules:**
- The agent machine must be able to reach cameras on ports 554 and 80 (LAN).
- The agent machine must be able to reach the cloud server on port 443 (internet).
- Port 8889 on the agent must be accessible from the internet if remote viewing is needed. If only on-premises viewing is needed, 8889 only needs LAN access.

---

## 6. Operations Guide

### 6.1 User Roles

The system has 4 roles in a strict hierarchy:

| Role | Level | Access | Typical User |
|---|---|---|---|
| `SUPER_ADMIN` | Company | Full access to everything — all schools, all settings, all users | InfoSec system administrator |
| `OPS_VIEWER` | Company | Read-only ops access, can view all schools' status/alerts, **cannot view live feeds** | InfoSec operations staff |
| `SCHOOL_ADMIN` | School | Manages own school — view cameras/feeds, resolve alerts, manage users within their school | Head of security at a school |
| `SCHOOL_VIEWER` | School | View-only access to own school — cameras, live feeds, alerts (cannot resolve) | Security guard, school staff |

### 6.2 Role Permissions Detail

| Permission | SUPER_ADMIN | OPS_VIEWER | SCHOOL_ADMIN | SCHOOL_VIEWER |
|---|---|---|---|---|
| Access Ops Portal | Yes | Yes | No | No |
| Access School Portal | Yes | No | Yes | Yes |
| Manage Schools | Yes | No | No | No |
| View All Schools | Yes | Yes | No | No |
| Edit Feature Flags | Yes | No | No | No |
| View Cameras | Yes | Yes | Yes | Yes |
| View Live Feeds | Yes | **No** | Yes | Yes |
| View Alerts | Yes | Yes | Yes | Yes |
| Resolve Alerts | Yes | No | Yes | No |
| View All Alerts (cross-school) | Yes | Yes | No | No |
| Manage Users (own school) | Yes | No | Yes | No |
| Manage All Users (any school) | Yes | No | No | No |
| View Dashboard | Yes | No | Yes | Yes |
| View Ops Dashboard | Yes | Yes | No | No |

### 6.3 Navigation by Role

**SUPER_ADMIN / OPS_VIEWER — Ops Portal:**
- `/ops/dashboard` — Cross-school overview, bridge statuses, alerts summary
- `/ops/schools` — List all schools, drill into each school's details
- `/ops/schools/[id]` — Individual school cameras, settings, status
- `/ops/alerts` — Cross-school alert feed
- `/ops/users` — Cross-school user management (SUPER_ADMIN only)

**SCHOOL_ADMIN / SCHOOL_VIEWER — School Portal:**
- `/dashboard` — School dashboard with real-time camera status, motion stats
- `/cameras` — Camera grid with live status indicators, motion flashes
- `/alerts` — School-specific alert feed
- `/management` — School management and configuration
- `/users` — User management (SCHOOL_ADMIN only)

---

## 7. Settings & Configuration

### 7.1 School Feature Flags

Each school has per-school feature flags and limits. **Only SUPER_ADMIN can change these.**

| Flag | Type | Default | Description |
|---|---|---|---|
| `localStorageEnabled` | boolean | `true` | Enables local FFmpeg recording at the school agent |
| `cloudStorageEnabled` | boolean | `false` | Enables cloud storage upload (not yet implemented) |
| `remoteAccessEnabled` | boolean | `false` | Allows live viewing from outside the school's LAN |
| `localViewEnabled` | boolean | `true` | Enables live camera viewing entirely |
| `retentionDays` | number | `14` | Days to keep local recordings before auto-deletion |
| `maxCameras` | number | `16` | Maximum number of cameras allowed for this school |
| `maxUsers` | number | `10` | Maximum number of active user accounts for this school |

### 7.2 Changing School Settings

**Via Dashboard (SUPER_ADMIN):**

Navigate to Ops Portal → Schools → select a school → Settings.

**Via API:**

```bash
# Authenticate first and get a session token, or use curl with cookies

# Update a school's settings
curl -X PATCH https://security.yourdomain.com/api/schools/{schoolId}/settings \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN" \
  -d '{
    "remoteAccessEnabled": true,
    "maxCameras": 32,
    "retentionDays": 30
  }'
```

**Validation rules:**
- Boolean flags (`*Enabled`) must be `true` or `false`
- Numeric limits (`retentionDays`, `maxCameras`, `maxUsers`) must be positive integers (>= 1)
- Only the 7 allowed fields are accepted — all others are ignored
- Changes take effect within 60 seconds (feature flag cache TTL)

### 7.3 Changing School Settings via Prisma Studio

For batch changes or settings not exposed via the API:

```bash
npx prisma studio
```

Open the `School` table, edit the record directly, and save.

---

## 8. User Management

### 8.1 Creating Users

**Who can create users:**
- `SUPER_ADMIN` — Can create any role for any school
- `SCHOOL_ADMIN` — Can create `SCHOOL_ADMIN` and `SCHOOL_VIEWER` within their own school

**Via Dashboard:**

Navigate to Users page → "Add User" button.

**Via API:**

```bash
curl -X POST https://security.yourdomain.com/api/users \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN" \
  -d '{
    "email": "newuser@school.edu",
    "name": "John Doe",
    "password": "secure-password-here",
    "role": "SCHOOL_VIEWER",
    "schoolId": "clx1abc123def456"
  }'
```

**Constraints:**
- Email must be unique across all users
- School-level roles (`SCHOOL_ADMIN`, `SCHOOL_VIEWER`) require a `schoolId`
- New users count toward the school's `maxUsers` limit
- Passwords are bcrypt-hashed with 12 salt rounds

### 8.2 Deactivating Users

Users are soft-deactivated (not deleted). Set `active: false` via the user management page or API:

```bash
# Option 1: PATCH with explicit active flag
curl -X PATCH https://security.yourdomain.com/api/users/{userId} \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN" \
  -d '{"active": false}'

# Option 2: DELETE (performs soft-deactivation, not hard delete)
curl -X DELETE https://security.yourdomain.com/api/users/{userId} \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

Deactivated users:
- Cannot log in (middleware blocks them)
- Don't count toward the `maxUsers` limit
- Can be reactivated by setting `active: true`

### 8.3 Role Hierarchy

Users can only manage roles at or below their level:

| Manager Role | Can Create/Edit |
|---|---|
| `SUPER_ADMIN` | `SUPER_ADMIN`, `OPS_VIEWER`, `SCHOOL_ADMIN`, `SCHOOL_VIEWER` |
| `SCHOOL_ADMIN` | `SCHOOL_ADMIN`, `SCHOOL_VIEWER` (own school only) |
| `OPS_VIEWER` | Cannot manage users |
| `SCHOOL_VIEWER` | Cannot manage users |

---

## 9. Alerts & Monitoring

### 9.1 Alert Types

| Type | Severity | Auto-Generated When |
|---|---|---|
| `CRITICAL` | Highest | Camera goes offline, camera misses 3+ heartbeats (>90s) |
| `WARNING` | Medium | 5+ motion events from one camera in 60 seconds, camera quality degradation |
| `INFO` | Low | Camera recovers from offline, system events |

### 9.2 Alert Auto-Generation

The system automatically creates alerts for:

1. **Camera Offline** — When a camera's RTSP becomes unreachable, the next heartbeat marks it OFFLINE and creates a CRITICAL alert.
2. **Missed Heartbeats** — If a camera was previously ONLINE but hasn't been seen in >90 seconds, the health endpoint marks it OFFLINE with a CRITICAL alert.
3. **Camera Recovery** — When a previously OFFLINE camera comes back ONLINE, an INFO alert is created.
4. **Excessive Motion** — If 5+ motion events from the same camera occur within 60 seconds, a WARNING alert is created (rate counter resets after alerting).

### 9.3 Viewing Alerts

**Via Dashboard:**
- School users: `/alerts` — Shows alerts for their school only
- Ops users: `/ops/alerts` — Shows alerts across all schools

**Via API:**

```bash
# Get unresolved alerts for a school
curl "https://security.yourdomain.com/api/alerts?schoolId=xxx&resolved=false"

# Get CRITICAL alerts only
curl "https://security.yourdomain.com/api/alerts?type=CRITICAL&resolved=false"

# Paginate
curl "https://security.yourdomain.com/api/alerts?limit=20&offset=40"
```

Alerts are sorted: unresolved first, then CRITICAL before WARNING before INFO, then newest first.

### 9.4 Resolving Alerts

**Who can resolve:** `SUPER_ADMIN` and `SCHOOL_ADMIN`

```bash
curl -X POST https://security.yourdomain.com/api/alerts/{alertId}/resolve \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

### 9.5 Real-Time Monitoring

The dashboard receives real-time updates via Socket.io (WebSocket) on the path `/api/socketio`. Events include:

| Event | Description |
|---|---|
| `alert:new` | New alert created |
| `camera:statusChange` | Camera went online/offline/warning |
| `dashboard:update` | Dashboard statistics refreshed |
| `bridge:status` | Agent bridge connectivity changed |
| `motion:detected` | Motion event from a camera |

These are pushed to room-scoped Socket.io channels:
- `school:{schoolId}` — Events for a specific school
- `ops` — Cross-school events for ops users

---

## 10. Live Viewing

### 10.1 How Live Viewing Works

1. User clicks a camera in the dashboard
2. Browser calls `GET /api/stream/{cameraDatabaseId}`
3. Cloud checks: authentication, permissions, feature flags (`localViewEnabled`, `remoteAccessEnabled`), bridge status, camera status
4. Cloud returns a WHEP URL pointing to the agent's MediaMTX
5. Browser connects **directly** to the agent via WebRTC/WHEP — video bypasses the cloud entirely

### 10.2 Requirements for Live Viewing

- `localViewEnabled` must be `true` for the school
- `remoteAccessEnabled` must be `true` for viewing from outside the school LAN
- The school's StreamBridge must be `online`
- The camera must not be `OFFLINE`
- The user's role must have `canViewLiveFeeds` permission (excludes `OPS_VIEWER`)

### 10.3 Direct vs. Proxy Connections

- **Direct (preferred):** Agent has `AGENT_PUBLIC_URL` set and StreamBridge has a `publicUrl`. Browser connects directly to the agent. Best latency and performance.
- **Fallback:** If no public URL is configured, the stream URL falls back to the `internalUrl`. This only works if the browser is on the same LAN as the agent.

### 10.4 Supported Video Features

- WebRTC with H.264 video (transcoded from H.265 if needed)
- Audio passthrough (mute/unmute toggle in the UI)
- Configurable grid layouts: 2x2, 3x3, 4x4
- Real-time status indicators: online/offline, motion flash, recording indicator
- Auto-reconnect with exponential backoff on stream interruption

---

## 11. Recordings

### 11.1 Local Recording

When `LOCAL_STORAGE_ENABLED=true` on the agent:

- FFmpeg records each camera's RTSP stream in 10-minute MP4 segments
- Storage format: `{LOCAL_STORAGE_PATH}/{cameraId}/{YYYY-MM-DD}/segment_{HH-MM-SS}.mp4`
- Uses `-c copy` (no transcoding) for minimal CPU usage
- Auto-restarts FFmpeg processes with exponential backoff (5s base, max 5 retries)
- Daily retention cleanup at 2:00 AM deletes directories older than `RETENTION_DAYS`

### 11.2 Central NVR Sync (Optional)

For multi-site deployments where you want recordings aggregated to a central server:

**On the agent (`agent/.env`):**

```env
CENTRAL_SERVER_URL=https://central-nvr.example.com
CENTRAL_SERVER_API_KEY=your-central-api-key
```

**On the central server (`.env`):**

```env
CENTRAL_INGEST_ENABLED=true
CENTRAL_INGEST_API_KEY=your-central-api-key
CENTRAL_STORAGE_PATH=./central-recordings
```

The agent:
- Scans the local recording directory every 60 seconds for new complete segments
- Uploads the oldest pending segment per camera every 30 seconds
- Maintains a persistent queue file (`.central-sync-queue.json`) that survives restarts
- Retries failed uploads with exponential backoff (up to 10 retries)
- Prunes queue entries older than 7 days

---

## 12. Updating the System

### 12.1 Update the Company Server (Cloud Dashboard)

An automated update script is provided:

```bash
bash scripts/update-cloud.sh
```

This script:
1. Pulls the latest code from git
2. Installs dependencies
3. **Backs up the database** (pg_dump, compressed, keeps last 10)
4. Runs database migrations (`prisma migrate deploy`)
5. Generates the Prisma client
6. Builds Next.js
7. Restarts the PM2 process

For development environments where you don't need a database backup:

```bash
bash scripts/update-cloud.sh --skip-backup
```

**Manual update (if you prefer):**

```bash
git pull origin main
npm install
bash scripts/backup-db.sh              # Always backup first!
npx prisma migrate deploy              # Apply new migrations
npx prisma generate                    # Regenerate client
npm run build                          # Build Next.js
pm2 restart cloud-dashboard            # Restart
curl -s http://localhost:3001/api/healthz   # Verify
```

### 12.2 Update School Agents

An automated update script is provided:

```bash
bash scripts/update-agent.sh
```

This script:
1. Pulls the latest code from git
2. Installs agent dependencies
3. Restarts the PM2 process
4. Shows recent agent logs for verification

**Manual update:**

```bash
git pull origin main
cd agent && npm install
pm2 restart school-agent
pm2 logs school-agent --lines 20
```

### 12.3 Update Order

When updating both cloud and agents:

1. **Always update the cloud server first.** The versioned `/api/v1/` endpoints ensure backward compatibility — old agents continue working against the new cloud.
2. Update agents at each school site. Agents can be updated independently and at different times.
3. The legacy `/api/health`, `/api/motion`, and `/api/recordings/ingest` endpoints remain active alongside the versioned `/api/v1/` equivalents.

### 12.4 Database Migrations

The project uses **Prisma Migrate** (not `prisma db push`) for safe, tracked schema changes.

**Creating a new migration (development):**

```bash
# After editing prisma/schema.prisma:
npm run db:migrate
# Enter a descriptive name like "add_camera_notes_field"
```

**Applying migrations (production):**

```bash
npx prisma migrate deploy
```

Migration files are committed to git under `prisma/migrations/` and provide:
- An audit trail of all schema changes
- The ability to review changes before applying
- Safe rollback points (restore database from backup + re-run migrations up to a point)

---

## 13. Backup & Recovery

### 13.1 Database Backup

```bash
# One-command backup (creates timestamped, compressed dump)
npm run db:backup

# Or directly:
bash scripts/backup-db.sh
```

Backups are stored in `./backups/` as `.sql.gz` files. The script keeps the last 10 backups.

### 13.2 Automated Backup Before Updates

The `update-cloud.sh` script automatically runs a database backup before applying migrations. This is the recommended update workflow.

### 13.3 Manual Backup

```bash
pg_dump "$DATABASE_URL" > backup_$(date +%F).sql
gzip backup_$(date +%F).sql
```

### 13.4 Restoring from Backup

```bash
# Drop and recreate the database
sudo -u postgres psql -c "DROP DATABASE infosec;"
sudo -u postgres psql -c "CREATE DATABASE infosec OWNER infosec_user;"

# Restore from backup
gunzip -c backups/infosec_backup_2026-04-14_10-30-00.sql.gz | psql "$DATABASE_URL"

# Re-apply any migrations that were run after the backup
npx prisma migrate deploy
```

### 13.5 Recording Backups

Local recordings on school agents are stored on disk and managed by the retention system. For additional backup:

- Use `rsync` to mirror the recordings directory to a NAS or backup server
- Or enable Central NVR Sync to automatically upload recordings to a central location (see Section 11.2)

---

## 14. Troubleshooting

### 14.1 Cloud Dashboard Issues

**Server won't start:**
```bash
# Check if the port is in use
lsof -i :3001

# Check logs
pm2 logs cloud-dashboard --lines 50

# Verify database connectivity
curl -s http://localhost:3001/api/healthz | jq .
```

**"db: disconnected" in health check:**
- Verify `DATABASE_URL` in `.env` is correct
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Test connection: `psql "$DATABASE_URL" -c "SELECT 1"`

**Real-time updates not working (Socket.io):**
- The `start` script uses `server.ts` which includes Socket.io. If you're using `next start` directly instead of `npm run start`, Socket.io won't be initialized.
- Check browser console for WebSocket connection errors
- Verify no reverse proxy is blocking WebSocket upgrades (nginx needs `proxy_set_header Upgrade $http_upgrade`)

### 14.2 Agent Issues

**Heartbeat failing:**
```bash
# Check agent logs
pm2 logs school-agent --lines 30

# Common causes:
# - Wrong API_URL (must be the cloud server's public URL)
# - Wrong SCHOOL_ID (must match the school CUID in the database)
# - Wrong API_KEY (plaintext must match the bcrypt hash in StreamBridge)
# - Network: agent can't reach the cloud server on port 443
```

**Cameras showing OFFLINE:**
```bash
# Test RTSP reachability from the agent machine
nc -zv 192.168.1.101 554

# Check the RTSP URL in a player
ffprobe rtsp://192.168.1.101:554/stream1

# Common causes:
# - Camera IP changed
# - Camera firmware updated and changed RTSP path
# - Camera is powered off or network cable disconnected
# - Firewall blocking port 554 between agent and camera
```

**MediaMTX crashes / restarts repeatedly:**
```bash
# Check the agent logs for MediaMTX errors
pm2 logs school-agent | grep "StreamBridge"

# Common causes:
# - MEDIAMTX_PATH is wrong or binary is not executable
# - Port 8889 or 8554 already in use
# - Invalid RTSP URLs in CAMERAS env var
```

**Live viewing not working in browser:**
```bash
# Verify the stream URL is returned correctly
# (Requires authentication — use browser DevTools Network tab)
# The browser should make a GET to /api/stream/{cameraId}
# Response should include a whepUrl like: https://stream.school.com/CAM-01/whep

# Common causes:
# - AGENT_PUBLIC_URL not set — browser can't reach the agent
# - Port 8889 not open on the agent's firewall
# - remoteAccessEnabled is false for the school
# - localViewEnabled is false for the school
# - StreamBridge shows offline in the database
```

**Motion detection not working:**
```bash
# Check agent logs for ONVIF connection status
pm2 logs school-agent | grep "Motion"

# Expected: "[Motion] CAM-01: ONVIF connected, subscribing to events"
# If you see: "[Motion] CAM-01: no ONVIF credentials, skipping ONVIF subscription"
#   → Add ONVIF credentials to the CAMERAS env var
# If you see: "[Motion] CAM-01: ONVIF connection failed"
#   → Camera doesn't support ONVIF or credentials are wrong
#   → Try: test ONVIF with a tool like ONVIF Device Manager
```

### 14.3 Database Issues

**Migration fails:**
```bash
# Check migration status
npx prisma migrate status

# If a migration failed partially, you may need to:
# 1. Restore from backup
# 2. Fix the schema issue
# 3. Re-run migrations

# Force-resolve a failed migration (marks it as applied without running):
npx prisma migrate resolve --applied "migration_name"
```

**Seed accidentally run in production:**
The seed script now has a production safety guard. If `NODE_ENV=production`, it will refuse to run unless the `--force` flag is explicitly passed:
```bash
# This will be BLOCKED in production:
npx prisma db seed

# This will work (but deletes all data):
npx tsx prisma/seed.ts --force
```

---

## 15. CI/CD & Development

### 15.1 GitHub Actions CI Pipeline

The project includes a CI pipeline at `.github/workflows/ci.yml` that runs on pushes and pull requests to `main`. It has two jobs:

**Job 1 — Lint & Typecheck (Cloud Dashboard):**
1. Installs dependencies (`npm ci`)
2. Validates Prisma schema (`npx prisma validate`)
3. Generates Prisma client (`npx prisma generate`)
4. Runs ESLint (`npm run lint`)
5. Runs TypeScript type-checking (`npm run typecheck`)
6. Builds the Next.js application (`npm run build`)

**Job 2 — Agent Typecheck:**
1. Installs agent dependencies (`cd agent && npm ci`)
2. Runs TypeScript type-checking on the agent code

### 15.2 Development Scripts

In addition to the core `dev`, `build`, and `start` scripts, these are available:

| Script | Command | Description |
|---|---|---|
| `npm run lint` | `next lint` | Run ESLint on the codebase |
| `npm run typecheck` | `tsc --noEmit` | TypeScript type-checking without emitting |
| `npm run db:studio` | `npx prisma studio` | Open Prisma Studio GUI at http://localhost:5555 |
| `npm run db:migrate` | `npx prisma migrate dev` | Create a new migration (development) |
| `npm run db:migrate:deploy` | `npx prisma migrate deploy` | Apply pending migrations (production) |
| `npm run db:backup` | `bash scripts/backup-db.sh` | Create a compressed database backup |
| `npm run prisma:validate` | `npx prisma validate` | Validate the Prisma schema |

---

## 16. API Reference (Agent Endpoints)

These are the versioned endpoints that agents communicate with. Legacy (unversioned) endpoints remain active for backward compatibility. Legacy paths (`/api/health`, `/api/motion`, `/api/recordings/ingest`) are functionally identical to their `/api/v1/` counterparts.

### POST /api/v1/health

Agent heartbeat. Reports camera statuses and bridge health.

**Authentication:** `schoolId` and `apiKey` in request body (API key verified against bcrypt hash in StreamBridge).

```json
// Request body
{
  "schoolId": "clx...",
  "apiKey": "plaintext-key",
  "cameras": [
    { "cameraId": "CAM-01", "status": "ONLINE", "rtspReachable": true },
    { "cameraId": "CAM-02", "status": "OFFLINE", "rtspReachable": false }
  ],
  "bridgeOnline": true,
  "timestamp": "2026-04-14T12:00:00.000Z",
  "publicUrl": "https://stream.school.com",
  "recording": {
    "activeRecordings": 5,
    "recordingCameras": ["CAM-01", "CAM-02"],
    "diskUsageGB": 42.5
  }
}

// Response
{
  "status": "ok",
  "processed": 2,
  "staleDetected": 0,
  "timestamp": "2026-04-14T12:00:00.500Z"
}
```

### POST /api/v1/motion

Agent motion event report. Creates a MotionEvent record and emits real-time Socket.io event.

**Authentication:** `X-School-ID` and `X-API-Key` headers.

```json
// Request headers
// X-School-ID: clx...
// X-API-Key: plaintext-key

// Request body
{
  "cameraId": "CAM-01",
  "schoolId": "clx...",
  "timestamp": "2026-04-14T12:00:00.000Z",
  "confidence": 0.95           // optional, 0-1 detection confidence
}

// Response
{
  "status": "ok",
  "eventId": "clx...",
  "timestamp": "2026-04-14T12:00:00.000Z"
}
```

### POST /api/v1/recordings/ingest

Upload an MP4 recording segment from the agent to the central server.

**Authentication:** `X-API-Key` header (timing-safe comparison against `CENTRAL_INGEST_API_KEY`).
**Feature gate:** Only active when `CENTRAL_INGEST_ENABLED=true` on the cloud server.

```
POST /api/v1/recordings/ingest
Content-Type: video/mp4
X-API-Key: your-ingest-key
X-School-ID: clx...
X-Camera-ID: CAM-01
X-Date: 2026-04-14
X-Segment: segment_10-30-00.mp4

[binary MP4 body]
```

### GET /api/healthz

Cloud server health check for load balancers and uptime monitoring. No authentication required.

```json
// Response (healthy)
{
  "status": "healthy",
  "uptime": 3600.5,
  "timestamp": "2026-04-14T12:00:00.000Z",
  "db": "connected",
  "latencyMs": 3
}

// Response (unhealthy — HTTP 503)
{
  "status": "unhealthy",
  "uptime": 3600.5,
  "timestamp": "2026-04-14T12:00:00.000Z",
  "db": "disconnected",
  "error": "connection refused"
}
```

---

## 17. API Reference (Dashboard Endpoints)

These endpoints are used by the web dashboard and require session authentication (NextAuth cookie). They are not used by agents.

### GET /api/dashboard/stats

Returns real-time dashboard statistics for a school.

**Authentication:** Session cookie (NextAuth).

**Query parameters:**
- `schoolId` — Required for ops-level roles; school-level roles use their own school automatically.

```json
// Response
{
  "stats": {
    "camerasOnline": 12,
    "camerasTotal": 15,
    "activeAlerts": 3,
    "criticalAlerts": 1,
    "motionEvents": 47,
    "storageUsed": 68,
    "storageFree": "2.1TB"
  },
  "motionByCamera": [
    { "cameraId": "CAM-01", "cameraName": "Main Entrance", "count": 15 }
  ],
  "zones": [
    { "name": "Main Entrance", "status": "Motion" }
  ],
  "recentActivity": [
    { "id": "clx...", "time": "14:30", "type": "warning", "message": "Excessive motion detected — Main Entrance (CAM-01)" }
  ]
}
```

### GET /api/cameras

Lists cameras for the authenticated user's school (or a specified school for ops roles).

**Query parameters:** `schoolId` (optional, for ops roles)

### GET /api/cameras/[id]

Returns details for a single camera by database ID.

### GET /api/schools

Lists all schools. **Ops roles only** (`SUPER_ADMIN`, `OPS_VIEWER`).

### GET /api/schools/[id]

Returns details for a single school.

### PATCH /api/schools/[id]/settings

Updates school feature flags and limits. **SUPER_ADMIN only.**

See [Section 7.2](#72-changing-school-settings) for request body details.

### GET /api/alerts

Lists alerts with filtering and pagination.

**Query parameters:**
- `schoolId` — Filter by school
- `type` — Filter by alert type (`CRITICAL`, `WARNING`, `INFO`)
- `resolved` — Filter by resolution status (`true`/`false`)
- `limit` — Results per page (default 20)
- `offset` — Pagination offset

### POST /api/alerts/[id]/resolve

Resolves an alert. **SUPER_ADMIN and SCHOOL_ADMIN only.**

### GET /api/users

Lists users. Ops roles see all users; school roles see their own school's users.

### POST /api/users

Creates a new user. See [Section 8.1](#81-creating-users) for request body details.

### PATCH /api/users/[id]

Updates user fields (`name`, `email`, `role`, `active`, `password`).

### DELETE /api/users/[id]

Soft-deactivates a user (sets `active: false`). Equivalent to `PATCH` with `{"active": false}`.

### GET /api/stream/[cameraId]

Returns the WHEP URL for live WebRTC streaming. See [Section 10.1](#101-how-live-viewing-works) for the full flow.

### GET /api/recordings/[schoolId]/[cameraId]/[date]

Lists available recording segments for a camera on a given date. **Feature gate:** requires `CENTRAL_INGEST_ENABLED=true`.

**Path parameters:**
- `schoolId` — School CUID
- `cameraId` — Camera display ID (e.g., `CAM-01`)
- `date` — Date in `YYYY-MM-DD` format

```json
// Response
{
  "schoolId": "clx...",
  "cameraId": "CAM-01",
  "date": "2026-04-14",
  "segments": [
    { "name": "segment_10-30-00.mp4", "size": 52428800, "createdAt": "2026-04-14T10:30:00.000Z" },
    { "name": "segment_10-40-00.mp4", "size": 48234567, "createdAt": "2026-04-14T10:40:00.000Z" }
  ]
}
```

### GET /api/recordings/[schoolId]/[cameraId]/[date]/[segment]

Streams a specific MP4 recording segment. Supports HTTP `Range` requests for seeking. **Feature gate:** requires `CENTRAL_INGEST_ENABLED=true`.

**Path parameters:**
- `segment` — Segment filename (e.g., `segment_10-30-00.mp4`)

Returns `video/mp4` with `Accept-Ranges: bytes` header. Partial content (206) is returned for range requests.

---

## 18. Go Alternatives

The repository includes experimental Go-based implementations of both the dashboard and agent in the `dashboard-go/` and `agent-go/` directories. These are standalone alternatives to the Node.js/Next.js stack and are not required for standard deployments.

- **`agent-go/`** — Go implementation of the on-premises agent (health ping, motion detection, storage, central sync, stream bridge).
- **`dashboard-go/`** — Go implementation of the cloud dashboard with HTML templates, database migrations, and a built-in HTTP server.

These are provided as reference implementations and are not covered by the CI pipeline or update scripts.

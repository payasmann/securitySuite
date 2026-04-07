# InfoSec — Deployment Guide

## 1. Overview

InfoSec is a security camera management platform with two components:

- **Cloud Dashboard** — A Next.js 14.2 web application that provides the management UI, authentication, school/camera configuration, alert tracking, and real-time status monitoring. It runs on a central company server alongside PostgreSQL and Redis.

- **On-Premises Agent** — A lightweight Node.js process deployed at each school site. It connects to local IP cameras via RTSP, runs MediaMTX for WebRTC streaming, handles ONVIF motion detection, and optionally records via FFmpeg. It sends heartbeats and motion events to the Cloud Dashboard over HTTPS.

**Video never passes through the cloud.** The agent streams video locally via MediaMTX, and the cloud only provides authenticated WHEP URLs to browsers so they can connect directly to the agent's MediaMTX instance.

```
                        School Site (LAN)                          Company Server
  ┌─────────┐                                                  ┌──────────────────┐
  │ Camera 1 │──RTSP──┐                                        │  Cloud Dashboard  │
  └─────────┘         │    ┌─────────────────────┐  heartbeat  │  (Next.js 14.2)   │
  ┌─────────┐         ├───►│   On-Premises Agent  │────POST────►│                  │
  │ Camera 2 │──RTSP──┤    │                      │  /api/health│  PostgreSQL       │
  └─────────┘         │    │  ┌───────────┐       │  /api/motion│  Redis            │
  ┌─────────┐         │    │  │ MediaMTX  │       │             │                  │
  │ Camera N │──RTSP──┘    │  │ WHEP:8889 │       │             └────────┬─────────┘
  └─────────┘              │  │ RTSP:8554 │       │                      │
                           │  │ API :9997 │       │                      │
                           │  └─────┬─────┘       │           WHEP URL   │
                           └────────│─────────────┘          (authenticated)
                                    │                                │
                                    │  WebRTC/WHEP (port 8889)      │
                                    │◄──────────────────────────────┐│
                                    ▼                               ▼│
                           ┌──────────────┐                  ┌──────────────┐
                           │   Browser    │◄── Dashboard UI ──│   Browser    │
                           │  (LAN view)  │                  │ (remote view)│
                           └──────────────┘                  └──────────────┘
```

**Control flow**: Agent → Cloud (heartbeats via `POST /api/health`, motion via `POST /api/motion`). Cloud provides authenticated WHEP URLs to browsers via `GET /api/stream/[cameraId]`.

**Video flow**: Cameras → Agent (RTSP) → MediaMTX → Browser (WebRTC/WHEP on port 8889). The cloud never touches video data.

---

## 2. School Site — Agent Deployment

### 2.1 Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | Required |
| MediaMTX | Latest | Binary must be downloaded separately |
| FFmpeg | Any recent | Only required if local recording is enabled |
| NVIDIA GPU + drivers | — | Only required if you have H.265 cameras and want hardware transcoding |

### 2.2 Clone and Install

```bash
git clone <repo-url> infosec
cd infosec/agent
npm install
```

### 2.3 Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your site-specific values. See below for a full explanation of every variable.

### 2.4 CAMERAS Environment Variable

The `CAMERAS` variable defines which cameras the agent connects to. Format:

```
CAMERAS=cameraId:rtspUrl[:onvifUser:onvifPassword],cameraId:rtspUrl[:onvifUser:onvifPassword],...
```

- Comma-separated list of cameras
- Each camera entry: `cameraId:rtspUrl` (required), optionally followed by `:onvifUser:onvifPassword`
- The parser splits on comma first, then separates cameraId by the first colon, finds the RTSP URL, and parses ONVIF credentials from after the last "/" segment as `:user:pass`

**Example 1 — H.264 cameras only (no ONVIF motion detection):**

```
CAMERAS=CAM-01:rtsp://192.168.1.101:554/stream1,CAM-02:rtsp://192.168.1.102:554/stream1
```

**Example 2 — H.265 cameras with ONVIF credentials for motion detection:**

```
CAMERAS=CAM-01:rtsp://192.168.1.101:554/stream1:admin:password123,CAM-02:rtsp://192.168.1.102:554/stream1:admin:campass456
```

**Example 3 — Mixed (some with ONVIF, some without):**

```
CAMERAS=CAM-LOBBY:rtsp://192.168.1.101:554/stream1:admin:password123,CAM-PARKING:rtsp://192.168.1.102:554/stream1,CAM-GYM:rtsp://192.168.1.103:554/stream1:admin:gym999
```

### 2.5 Agent .env Variables

| Variable | Required | Default | Description | Example |
|---|---|---|---|---|
| `API_URL` | Yes | `http://localhost:3000` | URL of the Cloud Dashboard | `https://infosec.yourcompany.com` |
| `SCHOOL_ID` | Yes | — | CUID of the school record in the cloud database. Agent exits if missing. | `clxyz1234abcdef` |
| `API_KEY` | Yes | — | Plain-text API key. Must match the bcrypt hash stored in the corresponding StreamBridge record. Agent exits if missing. | `my-secret-agent-key-2024` |
| `MEDIAMTX_PATH` | No | `/usr/local/bin/mediamtx` | Path to the MediaMTX binary | `/usr/local/bin/mediamtx` |
| `MEDIAMTX_CONFIG` | No | `./mediamtx.yml` | Path for the generated MediaMTX config file | `./mediamtx.yml` |
| `TRANSCODE_ENABLED` | No | `true` | Enable transcoding of camera streams | `true` |
| `NVENC_ENABLED` | No | `true` | Use NVIDIA NVENC for hardware-accelerated transcoding (requires GPU). Agent auto-detects via `nvidia-smi`. | `true` |
| `TRANSCODE_BITRATE` | No | `4000` | Transcoding bitrate in kbps | `4000` |
| `LOCAL_STORAGE_PATH` | No | `./recordings` | Directory for FFmpeg recording segments | `/var/recordings` |
| `LOCAL_STORAGE_ENABLED` | No | `true` | Enable local FFmpeg recording | `true` |
| `FFMPEG_PATH` | No | `ffmpeg` | Path to FFmpeg binary | `/usr/bin/ffmpeg` |
| `RETENTION_DAYS` | No | `14` | Number of days to keep local recordings. Cleanup runs daily at 2 AM. | `14` |
| `AGENT_PUBLIC_URL` | No | — | Public URL of the agent for remote browser access. If unset, only LAN browsers can view streams. | `https://stream.willowdale.edu` |
| `HEARTBEAT_INTERVAL` | No | `30000` | Milliseconds between heartbeat pings to cloud | `30000` |
| `CAMERAS` | No | — | Camera definitions (see Section 2.4) | `CAM-01:rtsp://192.168.1.101:554/stream1` |
| `CENTRAL_SERVER_URL` | No | — | URL for central recording sync. Only enables centralSync if set. | `https://infosec.yourcompany.com` |
| `CENTRAL_SERVER_API_KEY` | No | — | API key for authenticating central recording uploads | `central-ingest-secret-key` |

### 2.6 Starting the Agent

**Development mode** (auto-restarts on file changes):

```bash
npm run dev
```

**Production mode**:

```bash
npm run start
```

**Production with PM2** (recommended):

```bash
pm2 start npm --name "infosec-agent" -- run start
```

See [Section 5](#5-production-hardening) for a complete PM2 ecosystem config.

### 2.7 Verification

When the agent starts successfully, the subsystems initialize in order:

1. **healthPing** — You should see heartbeat POST requests to the cloud succeeding (HTTP 200).
2. **streamBridge (MediaMTX)** — MediaMTX starts and logs listening on RTSP port 8554, WHEP port 8889, and API port 9997. The MediaMTX YAML config is programmatically generated from the `CAMERAS` env var.
3. **motionDetect (ONVIF)** — If ONVIF credentials are provided, the agent subscribes to ONVIF events on port 80 of each camera.
4. **localStorage (FFmpeg)** — If `LOCAL_STORAGE_ENABLED=true`, FFmpeg processes start recording to `{LOCAL_STORAGE_PATH}/{cameraId}/{YYYY-MM-DD}/segment_{HH-MM-SS}.mp4` in 10-minute segments using `-c copy` (no transcoding).
5. **centralSync** — If `CENTRAL_SERVER_URL` is set, watches the recordings directory and uploads completed MP4 segments to the central server.

**Things to verify:**

- Console output shows heartbeat succeeding (no connection errors to `API_URL`)
- MediaMTX is listening: `curl http://localhost:9997/v3/paths/list`
- RTSP streams are available: test with VLC using `rtsp://localhost:8554/<cameraId>`
- WHEP is reachable: `curl http://localhost:8889/<cameraId>/whep`
- If recording is enabled, check that segment files appear in `LOCAL_STORAGE_PATH`

---

## 3. Company Server — Cloud Server Deployment

### 3.1 Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | Required |
| PostgreSQL | 14+ | Required |
| Redis | 6+ | Required |

### 3.2 Clone and Install

```bash
git clone <repo-url> infosec
cd infosec
npm install
```

### 3.3 Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your server-specific values. See below for a full explanation of every variable.

### 3.4 Database Setup

**Create the PostgreSQL database:**

```bash
createdb infosec
# or via psql:
psql -U postgres -c "CREATE DATABASE infosec;"
```

**Push the Prisma schema to the database:**

```bash
npx prisma db push
```

> **Note:** This project uses `prisma db push` (schema push), NOT `prisma migrate`. There is no migrations directory.

**Seed the database with sample data:**

```bash
npx prisma db seed
```

The seed creates:
- **3 schools**: Willowdale, Riverside, Oakwood
- **6 users** (all with password `password123`):
  - `admin@infosec.app` — SUPER_ADMIN
  - `ops@infosec.app` — OPS_VIEWER
  - `admin@willowdale.edu` — school admin
  - `viewer@willowdale.edu` — school viewer
  - `admin@riverside.edu` — school admin
  - `admin@oakwood.edu` — school admin
- **19 cameras** across the schools
- **Alerts and motion events**
- **3 StreamBridge records** (one per school)

### 3.5 Cloud .env Variables

| Variable | Required | Default | Description | Example |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string | `postgresql://user:password@localhost:5432/infosec?schema=public` |
| `NEXTAUTH_URL` | Yes | — | Public URL of the cloud dashboard | `https://infosec.yourcompany.com` |
| `NEXTAUTH_SECRET` | Yes | — | Secret for NextAuth JWT signing. Generate with `openssl rand -base64 32`. | `a1b2c3d4e5f6...` |
| `AUTH_SECRET` | Yes | — | Secret for NextAuth v5 auth. Can be the same as NEXTAUTH_SECRET. | `a1b2c3d4e5f6...` |
| `REDIS_URL` | Yes | — | Redis connection string | `redis://localhost:6379` |
| `S3_ENDPOINT` | No | — | S3-compatible storage endpoint | `https://s3.us-east-1.amazonaws.com` |
| `S3_ACCESS_KEY` | No | — | S3 access key | `AKIAIOSFODNN7EXAMPLE` |
| `S3_SECRET_KEY` | No | — | S3 secret key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `S3_BUCKET` | No | — | S3 bucket name | `infosec-recordings` |
| `S3_REGION` | No | `auto` | S3 region | `us-east-1` |
| `CENTRAL_INGEST_ENABLED` | No | — | Set to `"true"` to enable recording ingest endpoint | `true` |
| `CENTRAL_INGEST_API_KEY` | No | — | Shared secret for authenticating ingest uploads from agents | `central-ingest-secret-key` |
| `CENTRAL_STORAGE_PATH` | No | `./central-recordings` | Local directory for centrally ingested recordings | `/var/infosec/central-recordings` |

### 3.6 Starting the Cloud Server

**Development mode**:

```bash
npm run dev
```

**Production mode**:

```bash
npm run build
npm run start
```

To run on a custom port:

```bash
PORT=8080 npm run start
```

The server defaults to port **3000** if `PORT` is not set.

> **Note:** The cloud runs a custom HTTP server (`server.ts`) that hosts both the Next.js app and Socket.io on the same port. Socket.io uses the path `/api/socketio`.

### 3.7 Adding New Schools

Currently, schools are created via **Prisma Studio** or the database seed. There is no POST API route for creating schools.

**Step-by-step to add a new school:**

1. **Open Prisma Studio:**

   ```bash
   npx prisma studio
   ```

   This opens a web UI at `http://localhost:5555`.

2. **Create a School record:**
   - Navigate to the `School` model
   - Click "Add record"
   - Fill in the school name and other fields
   - Save the record and note the generated `id` (CUID)

3. **Create a StreamBridge record:**
   - Navigate to the `StreamBridge` model
   - Click "Add record"
   - Set `schoolId` to the School's CUID from step 2
   - Set `internalUrl` to the agent's LAN address, e.g., `http://192.168.1.100:8889`
   - Set `publicUrl` (optional) to the agent's public URL if remote access is needed
   - Set `apiKey` to a **bcrypt hash** of the plain-text key you'll use in the agent's `.env`
   - Set `online` to `false` (the agent will update this via heartbeats)
   - Save the record

4. **Generate the bcrypt hash for the API key:**

   ```bash
   node -e "const bcrypt = require('bcrypt'); bcrypt.hash('my-secret-agent-key-2024', 10).then(h => console.log(h));"
   ```

   Use the output as the `apiKey` value in the StreamBridge record. Use the plain-text value (`my-secret-agent-key-2024`) as the `API_KEY` in the agent's `.env`.

5. **Create User accounts** for the school (optional):
   - Navigate to the `User` model in Prisma Studio
   - Create users with the appropriate `schoolId` and role

6. **Configure the agent** at the school site with the `SCHOOL_ID` and `API_KEY` from above.

### 3.8 Verification

1. Open the dashboard in a browser at `http://localhost:3000` (or your configured URL)
2. Log in with a seed account:
   - **Super admin**: `admin@infosec.app` / `password123`
   - **Ops viewer**: `ops@infosec.app` / `password123`
   - **School admin**: `admin@willowdale.edu` / `password123`
3. Navigate to `/ops/dashboard` to see school and camera status
4. Once an agent is running and sending heartbeats, its school should show as "online"

---

## 4. Environment Variables Reference

| Variable | Component | Required | Default | Description | Example |
|---|---|---|---|---|---|
| `DATABASE_URL` | Cloud | Yes | — | PostgreSQL connection string | `postgresql://user:password@localhost:5432/infosec?schema=public` |
| `NEXTAUTH_URL` | Cloud | Yes | — | Public URL of the cloud dashboard | `https://infosec.yourcompany.com` |
| `NEXTAUTH_SECRET` | Cloud | Yes | — | JWT signing secret for NextAuth | `openssl rand -base64 32` |
| `AUTH_SECRET` | Cloud | Yes | — | Auth secret for NextAuth v5 | `openssl rand -base64 32` |
| `REDIS_URL` | Cloud | Yes | — | Redis connection string | `redis://localhost:6379` |
| `S3_ENDPOINT` | Cloud | No | — | S3-compatible storage endpoint | `https://s3.us-east-1.amazonaws.com` |
| `S3_ACCESS_KEY` | Cloud | No | — | S3 access key | `AKIAIOSFODNN7EXAMPLE` |
| `S3_SECRET_KEY` | Cloud | No | — | S3 secret key | `wJalrXUtnFEMI/K7MDENG/...` |
| `S3_BUCKET` | Cloud | No | — | S3 bucket name | `infosec-recordings` |
| `S3_REGION` | Cloud | No | `auto` | S3 region | `us-east-1` |
| `CENTRAL_INGEST_ENABLED` | Cloud | No | — | Set to `"true"` to enable recording ingest | `true` |
| `CENTRAL_INGEST_API_KEY` | Cloud | No | — | Shared secret for ingest auth | `central-ingest-secret-key` |
| `CENTRAL_STORAGE_PATH` | Cloud | No | `./central-recordings` | Path for centrally ingested recordings | `/var/infosec/central-recordings` |
| `API_URL` | Agent | Yes | `http://localhost:3000` | URL of the Cloud Dashboard | `https://infosec.yourcompany.com` |
| `SCHOOL_ID` | Agent | Yes | — | CUID of the school in the cloud DB | `clxyz1234abcdef` |
| `API_KEY` | Agent | Yes | — | Plain-text key matching bcrypt hash in StreamBridge | `my-secret-agent-key-2024` |
| `MEDIAMTX_PATH` | Agent | No | `/usr/local/bin/mediamtx` | Path to MediaMTX binary | `/usr/local/bin/mediamtx` |
| `MEDIAMTX_CONFIG` | Agent | No | `./mediamtx.yml` | Path for generated MediaMTX config | `./mediamtx.yml` |
| `TRANSCODE_ENABLED` | Agent | No | `true` | Enable stream transcoding | `true` |
| `NVENC_ENABLED` | Agent | No | `true` | Use NVIDIA NVENC hardware transcoding | `true` |
| `TRANSCODE_BITRATE` | Agent | No | `4000` | Transcoding bitrate in kbps | `4000` |
| `LOCAL_STORAGE_PATH` | Agent | No | `./recordings` | Directory for recording segments | `/var/recordings` |
| `LOCAL_STORAGE_ENABLED` | Agent | No | `true` | Enable local FFmpeg recording | `true` |
| `FFMPEG_PATH` | Agent | No | `ffmpeg` | Path to FFmpeg binary | `/usr/bin/ffmpeg` |
| `RETENTION_DAYS` | Agent | No | `14` | Days to keep local recordings (cleanup at 2 AM) | `14` |
| `AGENT_PUBLIC_URL` | Agent | No | — | Public URL for remote browser access to streams | `https://stream.willowdale.edu` |
| `HEARTBEAT_INTERVAL` | Agent | No | `30000` | Milliseconds between heartbeat pings | `30000` |
| `CAMERAS` | Agent | No | — | Camera definitions (see Section 2.4) | `CAM-01:rtsp://192.168.1.101:554/stream1` |
| `CENTRAL_SERVER_URL` | Agent | No | — | Central server URL for recording sync | `https://infosec.yourcompany.com` |
| `CENTRAL_SERVER_API_KEY` | Agent | No | — | API key for central recording uploads | `central-ingest-secret-key` |

---

## 5. Production Hardening

### 5.1 PM2 Setup

Install PM2 globally:

```bash
npm install -g pm2
```

Create `ecosystem.config.js` at the repository root:

```js
module.exports = {
  apps: [
    {
      name: "infosec-cloud",
      cwd: "./",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      max_memory_restart: "1G",
      error_file: "./logs/cloud-error.log",
      out_file: "./logs/cloud-out.log",
      merge_logs: true,
    },
    {
      name: "infosec-agent",
      cwd: "./agent",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      max_memory_restart: "512M",
      error_file: "./logs/agent-error.log",
      out_file: "./logs/agent-out.log",
      merge_logs: true,
    },
  ],
};
```

> **Note:** In most deployments, the cloud and agent run on different machines. Use only the relevant `apps` entry on each server.

Start with PM2:

```bash
# Cloud server only
pm2 start ecosystem.config.js --only infosec-cloud

# Agent server only
pm2 start ecosystem.config.js --only infosec-agent
```

### 5.2 Firewall Ports

**Cloud server:**

| Port | Protocol | Direction | Purpose | Scope |
|---|---|---|---|---|
| 3000 (or `PORT`) | TCP | Inbound | Dashboard UI + API + Socket.io | Public (or VPN) |
| 5432 | TCP | Internal | PostgreSQL | Localhost / internal only |
| 6379 | TCP | Internal | Redis | Localhost / internal only |

**Agent server:**

| Port | Protocol | Direction | Purpose | Scope |
|---|---|---|---|---|
| 8889 | TCP | Inbound | WebRTC/WHEP stream access | Inbound only if `AGENT_PUBLIC_URL` is set (remote viewers). Always accessible on LAN. |
| 8554 | TCP | Internal | RTSP (MediaMTX ↔ cameras) | Internal only |
| 9997 | TCP | Internal | MediaMTX API | Internal only |

### 5.3 Auto-Start After Reboot

```bash
pm2 startup
# Follow the printed command (e.g., sudo env PATH=... pm2 startup systemd -u youruser --hp /home/youruser)

pm2 save
```

This ensures PM2 restarts all saved processes on system boot.

### 5.4 Log Rotation

Install the PM2 log rotation module:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

---

## 6. Troubleshooting

### Agent not showing up on cloud dashboard

| Check | Details |
|---|---|
| `SCHOOL_ID` correct? | Must be the exact CUID of the School record in the cloud database. Copy it from Prisma Studio. |
| `API_KEY` matches? | The plain-text `API_KEY` in the agent `.env` must match the bcrypt hash stored in the `StreamBridge.apiKey` field for that school. The `/api/health` endpoint compares them using bcrypt. |
| `API_URL` reachable? | The agent must be able to reach the cloud server. Test: `curl <API_URL>/api/health` from the agent machine. |
| Network connectivity | Ensure no firewall is blocking outbound HTTPS from the agent to the cloud server on port 3000 (or your configured PORT). |
| StreamBridge record exists? | Each school needs exactly one StreamBridge record. Verify it exists in Prisma Studio. |

### Camera stream not connecting

| Check | Details |
|---|---|
| RTSP URL valid? | Test each RTSP URL directly with VLC: `vlc rtsp://192.168.1.101:554/stream1` |
| `CAMERAS` format correct? | Format: `cameraId:rtspUrl[:onvifUser:onvifPassword]`, comma-separated. No spaces around commas. |
| MediaMTX running? | Check that MediaMTX process is running. Verify with `curl http://localhost:9997/v3/paths/list`. |
| Port 8554 reachable? | MediaMTX must be able to pull RTSP from cameras. Ensure cameras and agent are on the same network or that routing is configured. |

### Live view not working in browser

| Check | Details |
|---|---|
| `AGENT_PUBLIC_URL` set? | If not set, only browsers on the school LAN can view streams (the cloud returns the `internalUrl` from StreamBridge). For remote access, set `AGENT_PUBLIC_URL` and ensure port 8889 is publicly accessible. |
| Port 8889 accessible? | The browser connects directly to the agent's MediaMTX WHEP endpoint on port 8889. Verify: `curl http://<agent-ip>:8889/<cameraId>/whep`. |
| WHEP endpoint responding? | Test the WHEP URL returned by `GET /api/stream/[cameraId]` (requires auth session). The cloud prefers `publicUrl`, falls back to `internalUrl`. |
| `remoteAccessEnabled` flag? | Check that the school's `remoteAccessEnabled` setting is enabled if accessing remotely. |
| `localViewEnabled` flag? | Check that the school's `localViewEnabled` setting is enabled. |

### Database errors

| Check | Details |
|---|---|
| `DATABASE_URL` correct? | Verify the connection string format: `postgresql://user:password@host:5432/dbname?schema=public` |
| PostgreSQL running? | Check: `pg_isready -h localhost -p 5432` |
| Schema pushed? | Run `npx prisma db push` to ensure the schema is up to date. This project uses schema push, not migrations. |
| Database exists? | Verify the database exists: `psql -U postgres -l` |

### FFmpeg recording errors

| Check | Details |
|---|---|
| `FFMPEG_PATH` correct? | Verify FFmpeg is installed and accessible: `ffmpeg -version` |
| FFmpeg installed? | Install via package manager if missing: `apt install ffmpeg` or `brew install ffmpeg` |
| RTSP URL valid? | Test: `ffmpeg -i rtsp://192.168.1.101:554/stream1 -t 5 -c copy test.mp4` |
| Disk space? | Recording segments are written to `LOCAL_STORAGE_PATH`. Ensure sufficient disk space. 10-minute segments with `-c copy` can be large depending on bitrate. |
| Permissions? | The Node.js process must have write permissions to `LOCAL_STORAGE_PATH`. |
| Retry exhaustion? | FFmpeg recording processes auto-restart up to 5 times with exponential backoff. Check logs for repeated restart failures. |

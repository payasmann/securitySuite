# InfoSec Platform — Operations Guide

This document explains how different users interact with the InfoSec school security camera platform on a day-to-day basis. Everything described here is based on the actual codebase and existing role definitions.

---

## Table of Contents

1. [Platform Overview](#platform-overview)
2. [Super Admin (Company Staff)](#1-super-admin-company-staff)
3. [School Admin (School IT or Management)](#2-school-admin-school-it-or-management)
4. [School Viewer (Security Guard, Receptionist, etc.)](#3-school-viewer-security-guard-receptionist-etc)
5. [How Live Viewing Works](#4-how-live-viewing-works)
6. [How Recording and Playback Works](#5-how-recording-and-playback-works)
7. [What Happens When Things Go Wrong](#6-what-happens-when-things-go-wrong)

---

## Platform Overview

InfoSec has two main parts:

- **The cloud dashboard** — a web application that all users log into. It shows camera statuses, alerts, and live feeds. It runs on a central server and is accessible from any browser.
- **The on-premises agent** — a small program installed physically at each school. It connects to the school's cameras, handles video streaming, records footage to the local disk, and reports status back to the cloud dashboard.

Video never passes through the cloud. When a user watches a live feed, their browser connects directly to the agent at the school. The cloud dashboard only coordinates the connection.

The platform defines four user roles:

| Role | Scope | Purpose |
|---|---|---|
| **SUPER_ADMIN** | All schools | Full platform control — company operations staff |
| **OPS_VIEWER** | All schools (read-only) | Company staff who need visibility but not control |
| **SCHOOL_ADMIN** | One school | School IT or management — runs their school's setup |
| **SCHOOL_VIEWER** | One school (read-only) | Security guards, receptionists — watches cameras |

---

## 1. Super Admin (Company Staff)

The Super Admin role is for InfoSec company staff who manage the entire platform across all schools.

### Logging In

1. Open the platform URL in a browser (e.g., `https://your-infosec-instance.com`).
2. You are directed to the login page, branded "SAFEGUARD — School Security Platform."
3. Enter your email and password. Passwords are verified against bcrypt hashes stored in the database.
4. On successful login, you are automatically redirected to the **Ops Dashboard** at `/ops/dashboard`. If you visit the root URL `/` while logged in, you are also redirected there.
5. Sessions last up to 8 hours (JWT-based). After that, you need to log in again.

### What You See — The Ops Dashboard

The Ops Dashboard (`/ops/dashboard`) is your home screen. It shows a cross-school overview that refreshes every 60 seconds:

**Top stat cards:**
- **Total Schools** — how many schools are configured on the platform.
- **Cameras Online** — the total number of online cameras across all schools, out of the total camera count.
- **Active Alerts** — the total number of unresolved alerts across all schools.
- **Offline Bridges** — how many school agent servers are currently not reporting in.

**Schools table (below the stats):**

Each row shows one school with:
- School name and slug identifier.
- Camera count (online / total), color-coded green when all cameras are up, yellow when some are down.
- Active alert count, highlighted red if any exist.
- Bridge status — a green or red dot showing whether the school's agent server is online or offline, with "Not configured" shown if no agent has been set up.
- Feature flags — small letter indicators: **R** (Remote Access), **C** (Cloud Storage), **L** (Local View), each colored green if enabled or gray if disabled.
- Action links: **Detail** (view school detail page) and **Settings** (manage feature flags and limits).

### Adding and Managing Schools

Schools are managed through the Ops portal:

- **School list** (`/ops/schools`) — shows all schools as cards with their name, slug, address, camera count, user count, alert count, bridge status, and links to View or Settings.
- **School detail** (`/ops/schools/[id]`) — a deep-dive into a single school showing:
  - Stat cards: cameras online/total, active alerts, active users, bridge status (online/offline).
  - Full camera table: every camera listed with its ID, name, zone, type, and status (ONLINE/OFFLINE/WARNING with a colored dot).
  - Active alerts section: lists unresolved alerts with severity, title, camera ID, and timestamp.
  - Users section: lists all users belonging to this school with their name, email, role, and active/inactive status.

- **School settings** (`/ops/schools/[id]/settings`) — where you configure a school's feature flags and limits. Changes are saved via `PATCH /api/schools/[id]/settings`. Available settings:

  **Feature flags (toggle on/off):**
  - **Local Storage** — whether the on-premises agent writes recordings to its local disk.
  - **Cloud Storage** — whether clips and snapshots are uploaded to cloud storage (R2/S3).
  - **Remote Access** — whether school users can log in from outside the school network. When off, the stream API blocks remote viewers.
  - **Local View** — whether live camera feed viewing is enabled at all. When off, no one can watch live feeds for this school.

  **Limits (numeric):**
  - **Retention Days** — how many days of local recordings to keep (1–365).
  - **Max Cameras** — maximum number of cameras allowed for this school (1–128).
  - **Max Users** — maximum number of active users allowed for this school (1–100).

### Monitoring All Schools from the Ops Dashboard

The Ops Dashboard is the primary monitoring tool. It auto-refreshes every 60 seconds. At a glance, you can spot:

- Schools with cameras down (camera count is not fully green).
- Schools with active alerts (alert count is non-zero and highlighted red).
- Schools with an offline agent (bridge shows "Offline" with a red dot).
- Schools with specific features disabled (feature flag dots are gray).

You can click **Detail** on any school row to drill down into that school's cameras, alerts, and users.

### Viewing Live Camera Feeds from Any School

As a Super Admin, you have the `canViewLiveFeeds` permission. You can access any school's cameras by navigating to the school portal. The middleware allows Super Admins to access school-level routes (`/cameras`, `/dashboard`, etc.).

When viewing cameras:
- The Camera Grid page (`/cameras`) shows all cameras for the selected school in a configurable grid (2x2, 3x3, or 4x4 layout).
- Each camera tile shows a live video feed (via WebRTC), the camera ID, name, and a status dot.
- Online cameras show the live feed with a "REC" indicator and a live timestamp.
- Offline cameras show "Camera Offline" with a red dot.
- If the school's Remote Access flag is off, you see "On-premises access only — Connect to the school network to view live feeds."
- If the school's bridge is offline, you see "Stream bridge is offline. Contact your administrator."

### Reviewing Recorded Footage

The platform has backend APIs for accessing recorded footage stored on the central server:
- `GET /api/recordings/[schoolId]/[cameraId]/[date]` — lists available 10-minute recording segments for a specific camera and date.
- `GET /api/recordings/[schoolId]/[cameraId]/[date]/[segment]` — streams a specific MP4 segment with HTTP Range support for seeking.

These APIs enforce authentication and school access checks. As a Super Admin, you can access recordings from any school.

**Note:** As of the current codebase, there is no dedicated recording browser or playback UI in the dashboard. The recording APIs exist and support video playback (including seeking via Range requests), but footage must currently be accessed via APIs directly or through a future playback interface.

### Managing Users Across Schools

**From the Ops portal** (`/ops/users`):
- View a table of all users across the entire platform.
- Each row shows: name, email, role (color-coded badge), assigned school (or "—" for ops users), and active/inactive status.
- The header shows the count: "X active of Y total."

**From the School portal** (`/users`, accessible to Super Admin):
- The User Management page allows creating, deactivating, and reactivating users for a specific school.
- **Creating a user**: Click "+ Add User", fill in name, email, password, and select a role. As a Super Admin, you can assign any role: SUPER_ADMIN, OPS_VIEWER, SCHOOL_ADMIN, or SCHOOL_VIEWER.
- **Deactivating a user**: Click the deactivate action on a user row. The user's `active` flag is set to false, and they are blocked from logging in (the middleware redirects inactive users to the login page with a "deactivated" error).
- **Reactivating a user**: Click the reactivate action on an inactive user row to restore access.

User counts per school are enforced against the school's `maxUsers` limit.

---

## 2. School Admin (School IT or Management)

The School Admin role is for people at a specific school who manage the day-to-day security operations for that school only.

### Logging In

1. Open the same platform URL as everyone else (e.g., `https://your-infosec-instance.com`). There is one login page for all roles — role-based routing happens after authentication.
2. Enter your email and password on the login page.
3. On successful login, you are automatically redirected to your **School Dashboard** at `/dashboard`. This is different from the Ops Dashboard — school roles never see the ops portal.
4. If you try to visit `/ops/*` routes, you are redirected to `/dashboard`.
5. Sessions last up to 8 hours.

### What You Can See — Only Your Own School

All data you see is scoped to your school. The API layer enforces this: every API route checks your `schoolId` from the session and only returns data belonging to that school. You cannot query or view data from other schools.

Your portal has a sidebar with navigation to:
- **Dashboard** — your school's overview
- **Cameras** — live camera grid
- **Alerts** — alert list for your school
- **Management** — camera status table
- **Users** — user management (School Admin only)

The topbar shows your school's name.

### Your School Dashboard

The School Dashboard (`/dashboard`) shows real-time data for your school:

**Stat cards:**
- **Cameras Online** — how many of your cameras are online, out of total.
- **Active Alerts** — how many unresolved alerts exist, with the critical count highlighted.
- **Motion Events** — number of motion events detected in the last 60 minutes.
- **Storage Used** — percentage of local storage used and free space remaining.

**Charts and feeds:**
- **Motion by Camera** — a bar chart showing which cameras have the most motion activity.
- **Zone Status** — shows each camera zone (Entry, Indoor, Outdoor, Parking, etc.) with a status: Clear (green), Motion (yellow), or Alert (red).
- **Recent Activity** — a timestamped feed of recent events (alerts, status changes) with severity color-coding.

The dashboard refreshes from the API every 60 seconds. Additionally, it receives **real-time Socket.io updates** for:
- New alerts (instantly added to activity feed and alert count)
- Camera status changes (online count updated immediately)
- Dashboard stat updates (pushed from the server)
- Motion detection events (motion counter and bar chart update live)

A small "Live" indicator in the top-left confirms the real-time connection is active.

### Viewing Live Feeds

Navigate to **Cameras** in the sidebar. The Camera Grid page shows all your school's cameras in a grid layout:

- Toggle grid size using the 2x2 / 3x3 / 4x4 buttons in the top-right corner.
- Header shows "Live Cameras — X/Y online."
- Each camera tile displays:
  - The live video feed (if the camera is online and the features allow it).
  - Camera ID and name in the info bar at the bottom.
  - A colored status dot (green = online, yellow = warning, red = offline).
  - A "REC" indicator in the top-left when recording is active.
  - A "MOTION" indicator with an amber border flash when motion is detected on that camera (auto-clears after 3–5 seconds).
  - A live clock timestamp in the bottom-right.

If a camera is offline, the tile shows "Camera Offline" instead of a feed. If the feed connection fails after 3 retries, it shows "Feed unavailable" with a Retry button.

The camera list refreshes every 30 seconds to pick up any status changes, and real-time motion events arrive via Socket.io.

### Reviewing Recorded Footage and Motion Events

**Camera Management table** (`/management`): This page lists all your school's cameras in a detailed table view:
- Columns: ID, Name, Zone, Type, Resolution, Status (with colored pill), Recording (shows "REC" with a pulsing red dot for cameras actively recording), Last Seen (relative time like "Just now", "5m ago").
- Summary in the header: total count, online count, warning count, offline count.

**Alerts page** (`/alerts`): Shows security-relevant events for your school:
- Filter by type: ALL, CRITICAL, WARNING, or INFO.
- Filter by status: Active, Resolved, or All.
- Each alert shows: severity dot, title, detail text, associated camera ID (if any), and relative timestamp.
- As a School Admin, you can **resolve alerts** by clicking the resolve button. This marks the alert as resolved and removes it from the active list.
- Common alert types you will see:
  - "Camera offline" (CRITICAL) — generated when a camera stops responding.
  - "Camera back online" (INFO) — generated when a camera recovers.
  - "Excessive motion detected" (WARNING) — generated when a camera reports 5+ motion events in 60 seconds.

**Recording playback**: The backend stores 10-minute MP4 segments organized by camera and date. Recording segment APIs exist at `/api/recordings/[schoolId]/[cameraId]/[date]` (listing) and `/api/recordings/[schoolId]/[cameraId]/[date]/[segment]` (streaming). Access is school-scoped — you can only access your own school's recordings. A dedicated playback UI has not yet been built in the dashboard.

### What You Cannot Do

- **Access other schools' data** — all API responses are filtered to your `schoolId`. Routes enforce this at both the middleware and API level.
- **Access the Ops portal** — visiting `/ops/*` routes redirects you to `/dashboard`.
- **Change school feature flags or limits** — the settings page is ops-only. You cannot toggle local storage, cloud storage, remote access, or live view. You cannot change retention days, max cameras, or max users.
- **Manage cameras** — you have `canManageCameras: false`. The camera management page is read-only: you can view camera details and status but cannot add, edit, or delete cameras.
- **View all alerts cross-school** — you only see alerts for your school.
- **Manage users outside your school** — you can create and deactivate users within your school, but only with the roles SCHOOL_ADMIN or SCHOOL_VIEWER. You cannot create SUPER_ADMIN or OPS_VIEWER accounts.

---

## 3. School Viewer (Security Guard, Receptionist, etc.)

The School Viewer role is for people who need to watch cameras and stay aware of alerts but do not need to manage anything.

### What They Can See vs. School Admin

| Capability | School Admin | School Viewer |
|---|---|---|
| View school dashboard | Yes | Yes |
| View live camera feeds | Yes | Yes |
| View alerts | Yes | Yes |
| Resolve alerts | Yes | **No** |
| View camera management table | Yes | Yes |
| Manage users | Yes (within school) | **No** |
| Access user management page | Yes | **No** (redirected to /dashboard) |

The School Viewer sees the exact same dashboard, camera grid, camera management table, and alert list as the School Admin. The differences are:

- **No "Resolve" button on alerts** — the button is only shown when the `canResolve` permission is true, which it is not for SCHOOL_VIEWER.
- **No access to the Users page** — the middleware restricts `/users` to SCHOOL_ADMIN and SUPER_ADMIN. A School Viewer attempting to visit `/users` is redirected to `/dashboard`.
- **No user management** — `canManageUsers` is false.

### Typical Day-to-Day Usage

A School Viewer's typical workflow:

1. **Log in** at the start of a shift using the same platform URL and login page as everyone else. After login, they land on the School Dashboard.
2. **Check the dashboard** — confirm cameras are online, note any active alerts, and glance at motion activity. The real-time "Live" indicator confirms the dashboard is receiving updates.
3. **Open the camera grid** — navigate to Cameras to see live feeds. Typically in a 3x3 or 4x4 grid on a dedicated monitoring screen. Motion events cause camera tiles to flash with an amber border and "MOTION" label.
4. **React to alerts** — when a new alert appears (via the real-time activity feed or the alerts page), they are aware of camera offline events or excessive motion warnings. They cannot resolve alerts themselves but can escalate to a School Admin.
5. **Review camera details** — navigate to Management to check which cameras are online, their last-seen times, and whether recording is active.
6. **End of shift** — session expires automatically after 8 hours, or they can close the browser.

---

## 4. How Live Viewing Works

### Where the Video Comes From

Live video comes directly from the school — it never passes through the InfoSec cloud servers. Here is the chain:

1. **IP cameras at the school** produce RTSP video streams on the local network.
2. **The InfoSec agent** (installed at the school) runs a program called **MediaMTX**. MediaMTX connects to each camera's RTSP stream and makes it available as a **WebRTC stream** using the WHEP protocol.
3. **The user's browser** connects directly to MediaMTX at the school to receive the video. The cloud dashboard only tells the browser *where* to connect.

### What Happens When You Click a Camera Feed

Step by step:

1. Your browser displays the Camera Grid. Each camera tile renders a `LiveFeed` component.
2. The LiveFeed component calls the cloud API: `GET /api/stream/[cameraId]`.
3. The API checks:
   - **Authentication** — are you logged in with a valid session?
   - **Permission** — does your role have `canViewLiveFeeds`? (SUPER_ADMIN, SCHOOL_ADMIN, SCHOOL_VIEWER: yes. OPS_VIEWER: no.)
   - **School access** — if you are a school user, does this camera belong to your school?
   - **Local View flag** — is live viewing enabled for this school? If not, the API returns an error.
   - **Remote Access flag** — is the school configured to allow remote viewing? If not, the API returns a `remoteBlocked` flag, and the camera tile shows "On-premises access only."
   - **Bridge status** — is the school's agent online? If not, the API returns a `bridgeOffline` flag.
   - **Camera status** — is the camera itself online? If not, the API returns a `cameraOffline` flag.
4. If all checks pass, the API returns a **WHEP URL** like `https://stream.school-slug.infosec.app/CAM-01/whep`. This URL points directly at the school's MediaMTX instance (via the agent's `publicUrl`).
5. The browser uses WebRTC to negotiate a connection with MediaMTX:
   - Creates a local `RTCPeerConnection`.
   - Generates an SDP offer requesting video and audio.
   - Sends the offer to the WHEP URL via HTTP POST.
   - Receives an SDP answer back from MediaMTX.
   - Establishes the WebRTC peer connection.
6. Video (and audio, if available) starts flowing directly from the school's agent to the browser.
7. If the connection fails, the browser retries up to 3 times with exponential backoff (1s, 2s, 4s). After 3 failures, it shows "Connection failed" with a Retry button.

### Why Internet Speed at the School Matters

Because the video streams directly from the school's agent to the viewer's browser:

- **Upload bandwidth at the school** is the bottleneck. Each viewer watching a camera consumes upload bandwidth at the school. If 10 people watch the same camera, MediaMTX serves 10 WebRTC streams, all using the school's upload pipe.
- **The cloud server's bandwidth is not a factor for video** — it only handles API calls (which are small JSON payloads).
- **Slow school internet** means choppy or low-resolution video for remote viewers. The agent can be configured to transcode video to a lower bitrate (the `TRANSCODE_BITRATE` setting in the agent config, default 4000 kbps) to reduce bandwidth requirements. If NVIDIA GPU hardware is available at the school, the agent uses hardware-accelerated encoding (NVENC); otherwise, it falls back to CPU-based encoding.
- **Viewers on the school's local network** have a much better experience because their traffic stays on the LAN and never crosses the internet.

---

## 5. How Recording and Playback Works

### Where Footage Is Stored

Footage is stored **locally at the school** on the agent's disk. The agent uses FFmpeg to continuously record each camera's RTSP stream into 10-minute MP4 segments.

The file structure on the agent's disk:

```
{LOCAL_STORAGE_PATH}/
  CAM-01/
    2026-04-06/
      segment_08-00-00.mp4   (10-minute segment starting at 08:00)
      segment_08-10-00.mp4   (next segment starting at 08:10)
      segment_08-20-00.mp4
      ...
    2026-04-07/
      segment_00-00-00.mp4
      ...
  CAM-02/
    2026-04-06/
      ...
```

Each camera gets its own directory. Inside that, recordings are organized by date (YYYY-MM-DD), with individual segment files named by their start time (segment_HH-MM-SS.mp4).

**Central server sync (optional):** If a central recording server is configured (via the `CENTRAL_SERVER_URL` environment variable on the agent), the agent also uploads completed segments to the central server. The sync process:
- Scans for new segments every 60 seconds.
- Uploads the oldest pending segment per camera every 30 seconds.
- Skips the most recently written file (it may still be in use by FFmpeg).
- Uses exponential backoff on upload failures (up to 10 retries per segment).
- Central storage mirrors the same directory structure: `{schoolId}/{cameraId}/{date}/{segment}`.

### How to Find and Play Back Footage

**Via recording APIs** (requires the central ingest feature to be enabled):

1. **List segments for a date**: Call `GET /api/recordings/{schoolId}/{cameraId}/{date}` (e.g., `/api/recordings/abc123/CAM-01/2026-04-06`). This returns a list of available segments with their names, file sizes, and creation timestamps.
2. **Play a specific segment**: Call `GET /api/recordings/{schoolId}/{cameraId}/{date}/{segment}` (e.g., `/api/recordings/abc123/CAM-01/2026-04-06/segment_08-00-00.mp4`). This streams the MP4 file directly with HTTP Range request support, which means a standard HTML5 `<video>` player can seek within the file.

Access is authenticated and school-scoped — school users can only access their own school's recordings; ops users can access any school.

**Note:** The dashboard does not yet have a recording browser or playback UI. The APIs are in place and support standard video playback, but a visual timeline or segment picker has not been built.

### What Happens to Old Footage

The agent runs a **retention cleanup job** that:
- Executes daily at **2:00 AM** local time on the agent server.
- Deletes all date-based recording directories older than the configured retention period.
- The retention period is set per school (default: 14 days, configurable from 1 to 365 days in the school settings).

For example, with a 14-day retention policy, on April 7th the cleanup removes all recordings from March 23rd and earlier. It logs each removed directory and the total disk space freed.

On the central server, the same retention logic would apply based on that server's configuration.

---

## 6. What Happens When Things Go Wrong

### Camera Goes Offline

**What the agent does:**
- The agent's health ping process checks each camera's RTSP port every heartbeat cycle (default: every 30 seconds). It opens a TCP connection to the camera's RTSP port with a 3-second timeout.
- If the connection fails, the camera's status is reported as `OFFLINE` in the next heartbeat.
- Status changes are logged: "[Health] CAM-01 UNREACHABLE" / "[Health] CAM-01 RECOVERED".

**What the cloud does:**
- The health API (`/api/health`) processes the agent's report and updates the camera's status in the database.
- If a camera transitions to `OFFLINE`, a **CRITICAL alert** is created: "Camera offline."
- If a camera transitions from `OFFLINE` back to `ONLINE`, an **INFO alert** is created: "Camera back online."

**What happens if RTSP is unreachable but the agent still reports the camera:**
- The cloud downgrades the camera to `WARNING` status (it can theoretically still be reachable via other means, but RTSP is down).

**Stale camera detection:**
- If the cloud has not received a status update for a camera in over 90 seconds (3 missed heartbeats at 30s intervals), it is automatically marked `OFFLINE` with a CRITICAL alert: "Camera offline (missed heartbeats)."

**What the dashboard shows:**
- The camera tile immediately changes: the live feed is replaced with "Camera Offline" and a red dot.
- The dashboard stat cards update: the online camera count decreases.
- The alert appears in the Recent Activity feed and on the Alerts page.
- On the Ops Dashboard, the school's camera count shows a yellow-highlighted mismatch (e.g., "3/5").

### School Internet Drops

**Does recording continue?** **Yes.** The agent records footage locally using FFmpeg, which connects to cameras over the local network (LAN). The agent's recording process does not depend on internet connectivity. As long as:
- The agent server itself is running.
- The cameras are reachable on the school's local network.
- The local disk has space.

...recording continues uninterrupted during an internet outage.

**What stops working:**
- **Remote live viewing** — browsers outside the school network can no longer reach the agent's MediaMTX. Viewers see "Connection failed" after retries.
- **Heartbeats stop** — the agent cannot reach the cloud API. After 90 seconds without a heartbeat, the cloud marks the school's bridge as offline and all cameras as stale (OFFLINE), triggering CRITICAL alerts.
- **Central sync pauses** — segment uploads to the central server fail. The central sync process retries with exponential backoff. When internet returns, it resumes uploading from where it left off (the local queue tracks which segments have been uploaded).
- **Real-time updates stop** — the dashboard no longer receives Socket.io events for this school.

**When internet comes back:**
- The agent's next heartbeat succeeds, updating camera statuses back to ONLINE.
- INFO alerts are generated for recovered cameras.
- The bridge status flips back to online.
- Central sync resumes uploading queued segments.
- No footage is lost — it was all being recorded locally throughout the outage.

### Agent Server Restarts

**MediaMTX (streaming):**
- If the MediaMTX process crashes, the agent automatically restarts it with exponential backoff: 1s, 2s, 4s, 8s, up to a maximum of 60 seconds between attempts.
- After running stably for 2 minutes, the restart counter resets to zero.
- During the restart, live viewers see their WebRTC connection drop. The browser's LiveFeed component retries the connection up to 3 times with exponential backoff.

**FFmpeg (recording):**
- If an FFmpeg recording process crashes for a camera, the agent restarts it with exponential backoff: 5s, 10s, 20s, 40s, 80s. After 5 consecutive crashes without stabilization, it gives up for that camera.
- After running stably for 10 seconds, the retry counter resets.
- A few seconds of footage may be lost between the crash and the restart.

**Full agent process restart** (e.g., server reboot):
- On startup, the agent initializes all subsystems: health pings, MediaMTX, ONVIF motion detection, local recording, and central sync.
- The first heartbeat is sent immediately on startup.
- MediaMTX generates a fresh configuration and starts. Cameras become available for live viewing as soon as MediaMTX finishes loading (typically a few seconds).
- Recording starts for all cameras immediately.
- Central sync resumes from its persisted queue file (`.central-sync-queue.json` in the storage directory), so no queued uploads are lost.

**How long until it shows online again:**
- The agent sends its first heartbeat immediately on startup. With a default heartbeat interval of 30 seconds, the cloud should register the agent as online within seconds of the agent process starting.
- The bridge `lastPingAt` timestamp is updated, and the `online` flag is set to true.
- If the agent was offline long enough for stale detection to trigger (90+ seconds), recovery alerts ("Camera back online") are generated for all cameras.

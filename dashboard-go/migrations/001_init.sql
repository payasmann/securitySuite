-- 001_init.sql
-- Creates all tables, enums, indexes, and constraints for the Safeguard dashboard.
-- Matches the Prisma schema exactly.

-- ─── Enums ────────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'OPS_VIEWER', 'SCHOOL_ADMIN', 'SCHOOL_VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "CameraStatus" AS ENUM ('ONLINE', 'OFFLINE', 'WARNING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "AlertType" AS ENUM ('CRITICAL', 'WARNING', 'INFO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── School ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "School" (
    id                     TEXT PRIMARY KEY,
    name                   TEXT        NOT NULL,
    slug                   TEXT        NOT NULL,
    address                TEXT,
    ip_range               TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Feature flags
    local_storage_enabled  BOOLEAN     NOT NULL DEFAULT TRUE,
    cloud_storage_enabled  BOOLEAN     NOT NULL DEFAULT FALSE,
    remote_access_enabled  BOOLEAN     NOT NULL DEFAULT FALSE,
    local_view_enabled     BOOLEAN     NOT NULL DEFAULT TRUE,

    -- Limits
    retention_days         INTEGER     NOT NULL DEFAULT 14,
    max_cameras            INTEGER     NOT NULL DEFAULT 16,
    max_users              INTEGER     NOT NULL DEFAULT 10
);

CREATE UNIQUE INDEX IF NOT EXISTS "School_slug_key" ON "School" (slug);
CREATE INDEX IF NOT EXISTS "School_slug_idx"        ON "School" (slug);

-- ─── User ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "User" (
    id          TEXT PRIMARY KEY,
    email       TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    password    TEXT        NOT NULL,
    role        "Role"      NOT NULL,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    school_id   TEXT        REFERENCES "School" (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key"     ON "User" (email);
CREATE INDEX IF NOT EXISTS "User_school_id_idx"        ON "User" (school_id);
CREATE INDEX IF NOT EXISTS "User_email_idx"            ON "User" (email);
CREATE INDEX IF NOT EXISTS "User_role_idx"             ON "User" (role);

-- ─── Camera ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Camera" (
    id           TEXT PRIMARY KEY,
    camera_id    TEXT            NOT NULL,
    name         TEXT            NOT NULL,
    zone         TEXT            NOT NULL,
    type         TEXT            NOT NULL,
    resolution   TEXT            NOT NULL,
    rtsp_url     TEXT            NOT NULL,
    status       "CameraStatus"  NOT NULL DEFAULT 'ONLINE',
    last_seen_at TIMESTAMPTZ,
    school_id    TEXT            NOT NULL REFERENCES "School" (id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "Camera_school_id_camera_id_key" ON "Camera" (school_id, camera_id);
CREATE INDEX IF NOT EXISTS "Camera_school_id_idx"                  ON "Camera" (school_id);
CREATE INDEX IF NOT EXISTS "Camera_status_idx"                     ON "Camera" (status);
CREATE INDEX IF NOT EXISTS "Camera_school_id_status_idx"           ON "Camera" (school_id, status);

-- ─── Alert ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Alert" (
    id          TEXT PRIMARY KEY,
    type        "AlertType"     NOT NULL,
    title       TEXT            NOT NULL,
    detail      TEXT,
    resolved    BOOLEAN         NOT NULL DEFAULT FALSE,
    camera_id   TEXT            REFERENCES "Camera" (id) ON DELETE SET NULL,
    school_id   TEXT            NOT NULL REFERENCES "School" (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Alert_school_id_idx"          ON "Alert" (school_id);
CREATE INDEX IF NOT EXISTS "Alert_school_id_type_idx"     ON "Alert" (school_id, type);
CREATE INDEX IF NOT EXISTS "Alert_school_id_resolved_idx" ON "Alert" (school_id, resolved);
CREATE INDEX IF NOT EXISTS "Alert_created_at_idx"         ON "Alert" (created_at);

-- ─── MotionEvent ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "MotionEvent" (
    id          TEXT PRIMARY KEY,
    count       INTEGER     NOT NULL DEFAULT 1,
    camera_id   TEXT        NOT NULL REFERENCES "Camera" (id) ON DELETE CASCADE,
    school_id   TEXT        NOT NULL REFERENCES "School" (id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "MotionEvent_camera_id_idx"            ON "MotionEvent" (camera_id);
CREATE INDEX IF NOT EXISTS "MotionEvent_school_id_idx"            ON "MotionEvent" (school_id);
CREATE INDEX IF NOT EXISTS "MotionEvent_recorded_at_idx"          ON "MotionEvent" (recorded_at);
CREATE INDEX IF NOT EXISTS "MotionEvent_school_id_recorded_at_idx" ON "MotionEvent" (school_id, recorded_at);

-- ─── StreamBridge ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "StreamBridge" (
    id           TEXT PRIMARY KEY,
    school_id    TEXT        NOT NULL REFERENCES "School" (id) ON DELETE CASCADE,
    internal_url TEXT        NOT NULL,
    public_url   TEXT,
    api_key      TEXT        NOT NULL,
    last_ping_at TIMESTAMPTZ,
    online       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "StreamBridge_school_id_key" ON "StreamBridge" (school_id);
CREATE INDEX IF NOT EXISTS "StreamBridge_school_id_idx"        ON "StreamBridge" (school_id);

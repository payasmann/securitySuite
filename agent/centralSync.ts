import { existsSync, readdirSync, statSync, writeFileSync, readFileSync, renameSync, mkdirSync } from "fs";
import { readFile } from "fs/promises";
import { join, basename } from "path";
import type { AgentConfig } from "./index";

// ── Constants ─────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS = 60_000;
const UPLOAD_INTERVAL_MS = 30_000;
const MAX_RETRIES = 10;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MULTIPLIER = 256; // 2^8
const FILE_SETTLE_MS = 30_000;
const QUEUE_PRUNE_DAYS = 7;
const QUEUE_FILENAME = ".central-sync-queue.json";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueueEntry {
  cameraId: string;
  date: string;
  segment: string;
  filePath: string;
  status: "pending" | "uploaded";
  addedAt: string;
  uploadedAt: string | null;
  lastAttempt: string | null;
  attempts: number;
}

// ── Module state ──────────────────────────────────────────────────────────────

let storedConfig: AgentConfig | null = null;
let scanTimer: ReturnType<typeof setInterval> | null = null;
let uploadTimer: ReturnType<typeof setInterval> | null = null;
let isUploading = false;

// ── Queue persistence ─────────────────────────────────────────────────────────

function getQueuePath(): string {
  return join(storedConfig!.localStoragePath, QUEUE_FILENAME);
}

function loadQueue(): QueueEntry[] {
  const queuePath = getQueuePath();
  try {
    if (existsSync(queuePath)) {
      const raw = readFileSync(queuePath, "utf-8");
      return JSON.parse(raw) as QueueEntry[];
    }
  } catch (err) {
    console.error(`[CentralSync] Failed to load queue: ${(err as Error).message}`);
  }
  return [];
}

function saveQueue(queue: QueueEntry[]): void {
  const queuePath = getQueuePath();
  const tmpPath = queuePath + ".tmp";
  try {
    writeFileSync(tmpPath, JSON.stringify(queue, null, 2), "utf-8");
    renameSync(tmpPath, queuePath);
  } catch (err) {
    console.error(`[CentralSync] Failed to save queue: ${(err as Error).message}`);
  }
}

// ── Directory scanner ─────────────────────────────────────────────────────────

function isDateDirectory(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(name);
}

function scanForNewSegments(): void {
  if (!storedConfig) return;

  const queue = loadQueue();
  const existingPaths = new Set(queue.map((e) => e.filePath));
  let added = 0;

  for (const camera of storedConfig.cameras) {
    const cameraDir = join(storedConfig.localStoragePath, camera.cameraId);
    if (!existsSync(cameraDir)) continue;

    let dateDirs: string[];
    try {
      dateDirs = readdirSync(cameraDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && isDateDirectory(d.name))
        .map((d) => d.name);
    } catch {
      continue;
    }

    for (const dateDir of dateDirs) {
      const datePath = join(cameraDir, dateDir);

      let segmentFiles: string[];
      try {
        segmentFiles = readdirSync(datePath)
          .filter((f) => /^segment_.*\.mp4$/.test(f))
          .sort();
      } catch {
        continue;
      }

      if (segmentFiles.length === 0) continue;

      // Skip the last file — it may still be written by FFmpeg
      const candidates = segmentFiles.slice(0, -1);

      const now = Date.now();

      for (const segment of candidates) {
        const filePath = join(datePath, segment);

        // Skip if already tracked
        if (existingPaths.has(filePath)) continue;

        try {
          const stat = statSync(filePath);

          // Skip empty files
          if (stat.size === 0) continue;

          // Skip files modified in the last 30 seconds
          if (now - stat.mtimeMs < FILE_SETTLE_MS) continue;
        } catch {
          continue;
        }

        queue.push({
          cameraId: camera.cameraId,
          date: dateDir,
          segment,
          filePath,
          status: "pending",
          addedAt: new Date().toISOString(),
          uploadedAt: null,
          lastAttempt: null,
          attempts: 0,
        });
        existingPaths.add(filePath);
        added++;
      }
    }
  }

  if (added > 0) {
    saveQueue(queue);
    console.log(`[CentralSync] Scanner found ${added} new segment(s)`);
  }
}

// ── Upload worker ─────────────────────────────────────────────────────────────

function getBackoffMs(attempts: number): number {
  const multiplier = Math.min(Math.pow(2, attempts), MAX_BACKOFF_MULTIPLIER);
  return BASE_BACKOFF_MS * multiplier;
}

function isInBackoff(entry: QueueEntry): boolean {
  if (!entry.lastAttempt || entry.attempts === 0) return false;
  const backoffMs = getBackoffMs(entry.attempts);
  const elapsed = Date.now() - new Date(entry.lastAttempt).getTime();
  return elapsed < backoffMs;
}

async function uploadSegment(entry: QueueEntry, centralUrl: string, apiKeyHeader: string): Promise<boolean> {
  // If the file was deleted by retention, mark as uploaded and move on
  if (!existsSync(entry.filePath)) {
    console.log(`[CentralSync] File no longer exists (retention?), skipping: ${entry.segment}`);
    return true;
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = await readFile(entry.filePath);
  } catch (err) {
    console.error(`[CentralSync] Failed to read ${entry.segment}: ${(err as Error).message}`);
    return false;
  }

  try {
    const res = await fetch(`${centralUrl}/api/v1/recordings/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileBuffer.length),
        "X-School-ID": storedConfig!.schoolId,
        "X-API-Key": apiKeyHeader,
        "X-Camera-ID": entry.cameraId,
        "X-Date": entry.date,
        "X-Segment": entry.segment,
      },
      body: fileBuffer,
    });

    if (res.status === 200) {
      console.log(`[CentralSync] Uploaded ${entry.cameraId}/${entry.date}/${entry.segment}`);
      return true;
    }

    if (res.status === 409) {
      console.log(`[CentralSync] Already exists on server: ${entry.cameraId}/${entry.date}/${entry.segment}`);
      return true;
    }

    const body = await res.text().catch(() => "");
    console.error(`[CentralSync] Upload failed (${res.status}): ${entry.cameraId}/${entry.date}/${entry.segment} — ${body}`);
    return false;
  } catch (err) {
    console.error(`[CentralSync] Network error uploading ${entry.segment}: ${(err as Error).message}`);
    return false;
  }
}

async function runUploadCycle(): Promise<void> {
  if (isUploading || !storedConfig) return;
  isUploading = true;

  try {
    const centralUrl = process.env.CENTRAL_SERVER_URL!;
    const apiKeyHeader = process.env.CENTRAL_SERVER_API_KEY || storedConfig.apiKey;

    const queue = loadQueue();

    // Group pending entries by camera
    const pendingByCamera = new Map<string, QueueEntry[]>();
    for (const entry of queue) {
      if (entry.status !== "pending") continue;
      if (entry.attempts >= MAX_RETRIES) continue;
      if (isInBackoff(entry)) continue;

      let list = pendingByCamera.get(entry.cameraId);
      if (!list) {
        list = [];
        pendingByCamera.set(entry.cameraId, list);
      }
      list.push(entry);
    }

    // For each camera, upload the oldest pending segment
    for (const [, entries] of pendingByCamera) {
      // Sort by addedAt to get the oldest first
      entries.sort((a, b) => a.addedAt.localeCompare(b.addedAt));

      const entry = entries[0];
      const success = await uploadSegment(entry, centralUrl, apiKeyHeader);

      // Update the entry in the queue array
      const queueEntry = queue.find((e) => e.filePath === entry.filePath);
      if (queueEntry) {
        if (success) {
          queueEntry.status = "uploaded";
          queueEntry.uploadedAt = new Date().toISOString();
        } else {
          queueEntry.attempts++;
          queueEntry.lastAttempt = new Date().toISOString();
        }
      }
    }

    // Prune old entries
    const cutoffMs = Date.now() - QUEUE_PRUNE_DAYS * 24 * 60 * 60 * 1000;
    const prunedQueue = queue.filter((entry) => {
      const addedMs = new Date(entry.addedAt).getTime();
      if (addedMs >= cutoffMs) return true;

      // Keep entries that are still pending and haven't exceeded retries
      if (entry.status === "pending" && entry.attempts < MAX_RETRIES) return true;

      // Remove uploaded or max-retried entries older than prune threshold
      return false;
    });

    saveQueue(prunedQueue);
  } finally {
    isUploading = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initCentralSync(config: AgentConfig): void {
  const centralUrl = process.env.CENTRAL_SERVER_URL;
  if (!centralUrl) return;

  storedConfig = config;

  // Ensure storage directory exists for the queue file
  if (!existsSync(config.localStoragePath)) {
    mkdirSync(config.localStoragePath, { recursive: true });
  }

  // Startup logging
  const queue = loadQueue();
  const pendingCount = queue.filter((e) => e.status === "pending").length;
  const uploadedCount = queue.filter((e) => e.status === "uploaded").length;

  console.log(`[CentralSync] Central server: ${centralUrl}`);
  console.log(`[CentralSync] Queue stats — pending: ${pendingCount}, uploaded: ${uploadedCount}`);

  // Start directory scanner
  scanForNewSegments();
  scanTimer = setInterval(scanForNewSegments, SCAN_INTERVAL_MS);

  // Start upload worker
  runUploadCycle();
  uploadTimer = setInterval(() => {
    runUploadCycle();
  }, UPLOAD_INTERVAL_MS);
}

export function stopCentralSync(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }

  if (uploadTimer) {
    clearInterval(uploadTimer);
    uploadTimer = null;
  }

  storedConfig = null;
}

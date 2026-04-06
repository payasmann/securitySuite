import { mkdirSync, existsSync, readdirSync, statSync, rmSync } from "fs";
import { join, basename } from "path";
import { spawn, execSync, type ChildProcess } from "child_process";
import type { AgentConfig } from "./index";

// ── Module state ──────────────────────────────────────────────────────────────

const recordingProcesses = new Map<string, ChildProcess>();
const retryCounts = new Map<string, number>();
let storedConfig: AgentConfig | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 5_000;

// ── FFmpeg availability check ─────────────────────────────────────────────────

function checkFfmpeg(ffmpegPath: string): boolean {
  try {
    execSync(`"${ffmpegPath}" -version`, { timeout: 10_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── Per-camera recording ──────────────────────────────────────────────────────

function startRecording(camera: { cameraId: string; rtspUrl: string }, config: AgentConfig): void {
  const cameraId = camera.cameraId;

  // Build output path with strftime placeholders
  // FFmpeg's strftime will expand %Y-%m-%d and %H-%M-%S at segment boundaries
  const outputPattern = join(
    config.localStoragePath,
    cameraId,
    "%Y-%m-%d",
    "segment_%H-%M-%S.mp4"
  );

  // Ensure the camera base directory exists (date subdirs created by FFmpeg strftime)
  const cameraDir = join(config.localStoragePath, cameraId);
  if (!existsSync(cameraDir)) {
    mkdirSync(cameraDir, { recursive: true });
  }

  const args = [
    "-rtsp_transport", "tcp",
    "-i", camera.rtspUrl,
    "-c", "copy",
    "-f", "segment",
    "-segment_time", "600",
    "-segment_format", "mp4",
    "-strftime", "1",
    "-reset_timestamps", "1",
    outputPattern,
  ];

  console.log(`[Storage] Starting recording for ${cameraId}`);

  const proc = spawn(config.ffmpegPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  recordingProcesses.set(cameraId, proc);

  proc.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    // Only log meaningful FFmpeg errors, skip verbose progress output
    if (line.includes("Error") || line.includes("error") || line.includes("fatal")) {
      console.error(`[Storage] FFmpeg ${cameraId}: ${line}`);
    }
  });

  proc.on("exit", (code, signal) => {
    recordingProcesses.delete(cameraId);

    // If we're shutting down (SIGTERM/SIGINT), don't restart
    if (signal === "SIGTERM" || signal === "SIGINT") {
      console.log(`[Storage] Recording stopped for ${cameraId} (shutdown)`);
      return;
    }

    const retries = retryCounts.get(cameraId) || 0;

    if (retries >= MAX_RETRIES) {
      console.error(
        `[Storage] ERROR: FFmpeg for ${cameraId} crashed ${MAX_RETRIES} times — giving up`
      );
      return;
    }

    const backoffMs = BASE_BACKOFF_MS * Math.pow(2, retries);
    retryCounts.set(cameraId, retries + 1);

    console.warn(
      `[Storage] FFmpeg for ${cameraId} exited (code=${code}). Restarting in ${backoffMs}ms (retry ${retries + 1}/${MAX_RETRIES})`
    );

    setTimeout(() => {
      if (storedConfig) {
        startRecording(camera, storedConfig);
      }
    }, backoffMs);
  });

  // Reset retry count on successful start (give it 10s to stabilize)
  setTimeout(() => {
    if (recordingProcesses.has(cameraId)) {
      retryCounts.set(cameraId, 0);
    }
  }, 10_000);
}

// ── Retention cleanup ─────────────────────────────────────────────────────────

function isDateDirectory(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(name);
}

function getDirectorySize(dirPath: string): number {
  let totalSize = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += getDirectorySize(fullPath);
      } else {
        try {
          totalSize += statSync(fullPath).size;
        } catch {
          // File may have been deleted between readdir and stat
        }
      }
    }
  } catch {
    // Directory may not exist or be inaccessible
  }
  return totalSize;
}

function runCleanup(storagePath: string, retentionDays: number): void {
  console.log(`[Storage] Running retention cleanup (keeping ${retentionDays} days)`);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  cutoffDate.setHours(0, 0, 0, 0);

  let totalFreed = 0;
  let dirsRemoved = 0;

  try {
    const cameraDirs = readdirSync(storagePath, { withFileTypes: true });

    for (const cameraEntry of cameraDirs) {
      if (!cameraEntry.isDirectory()) continue;

      const cameraPath = join(storagePath, cameraEntry.name);

      try {
        const dateDirs = readdirSync(cameraPath, { withFileTypes: true });

        for (const dateEntry of dateDirs) {
          if (!dateEntry.isDirectory()) continue;
          if (!isDateDirectory(dateEntry.name)) continue;

          const dirDate = new Date(dateEntry.name + "T00:00:00");
          if (isNaN(dirDate.getTime())) continue;

          if (dirDate < cutoffDate) {
            const dirPath = join(cameraPath, dateEntry.name);
            const dirSize = getDirectorySize(dirPath);

            try {
              rmSync(dirPath, { recursive: true, force: true });
              totalFreed += dirSize;
              dirsRemoved++;
              console.log(`[Storage] Removed ${dateEntry.name} from ${cameraEntry.name} (${(dirSize / 1024 / 1024).toFixed(1)} MB)`);
            } catch (err) {
              console.error(`[Storage] Failed to remove ${dirPath}: ${(err as Error).message}`);
            }
          }
        }
      } catch {
        // Skip inaccessible camera directories
      }
    }
  } catch {
    console.error(`[Storage] Cannot read storage path: ${storagePath}`);
  }

  const freedMB = (totalFreed / 1024 / 1024).toFixed(1);
  console.log(`[Storage] Cleanup complete: removed ${dirsRemoved} directories, freed ${freedMB} MB`);
}

function scheduleCleanup(config: AgentConfig): void {
  // Schedule daily cleanup at 2:00 AM
  function scheduleNext(): void {
    const now = new Date();
    const next2AM = new Date(now);
    next2AM.setHours(2, 0, 0, 0);

    // If it's already past 2 AM today, schedule for tomorrow
    if (now >= next2AM) {
      next2AM.setDate(next2AM.getDate() + 1);
    }

    const delayMs = next2AM.getTime() - now.getTime();

    console.log(
      `[Storage] Next retention cleanup scheduled in ${(delayMs / 3_600_000).toFixed(1)} hours`
    );

    cleanupTimer = setTimeout(() => {
      runCleanup(config.localStoragePath, config.retentionDays);
      scheduleNext();
    }, delayMs);
  }

  scheduleNext();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initLocalStorage(config: AgentConfig): void {
  if (!config.localStorageEnabled) {
    console.log("[Storage] Local storage disabled");
    return;
  }

  // Check FFmpeg availability
  if (!checkFfmpeg(config.ffmpegPath)) {
    console.error(
      `[Storage] ERROR: FFmpeg not found at ${config.ffmpegPath} — local recording disabled`
    );
    return;
  }

  console.log(`[Storage] FFmpeg found at ${config.ffmpegPath}`);

  storedConfig = config;
  const storagePath = config.localStoragePath;

  // Create storage directory if it doesn't exist
  if (!existsSync(storagePath)) {
    mkdirSync(storagePath, { recursive: true });
    console.log(`[Storage] Created storage directory: ${storagePath}`);
  }

  console.log(`[Storage] Local storage initialized at ${storagePath}`);
  console.log(`[Storage] Starting recording for ${config.cameras.length} cameras`);

  // Start recording for each camera
  for (const camera of config.cameras) {
    startRecording(camera, config);
  }

  // Schedule retention cleanup
  scheduleCleanup(config);

  console.log(`[Storage] Retention policy: ${config.retentionDays} days`);
}

export function stopAllRecordings(): void {
  console.log(`[Storage] Stopping ${recordingProcesses.size} recording(s)...`);

  for (const [cameraId, proc] of recordingProcesses) {
    try {
      proc.kill("SIGTERM");
      console.log(`[Storage] Stopped recording for ${cameraId}`);
    } catch {
      // Process may have already exited
    }
  }

  recordingProcesses.clear();
  retryCounts.clear();

  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
}

export function getRecordingStatus(): { activeRecordings: number; cameras: string[] } {
  const activeCameras: string[] = [];

  for (const [cameraId] of recordingProcesses) {
    activeCameras.push(cameraId);
  }

  return {
    activeRecordings: activeCameras.length,
    cameras: activeCameras,
  };
}

export function getDiskUsageGB(): number {
  if (!storedConfig) return 0;

  const totalBytes = getDirectorySize(storedConfig.localStoragePath);
  return Math.round((totalBytes / 1_073_741_824) * 100) / 100; // bytes → GB, 2 decimal places
}

import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { AgentConfig } from "./index";

/**
 * Local storage manager for camera recordings.
 * 
 * In production, this would:
 * 1. Use FFmpeg to record RTSP streams to disk in segments
 * 2. Manage disk space by deleting old recordings based on retentionDays
 * 3. Upload clips to cloud storage if cloudStorageEnabled
 */

export function initLocalStorage(config: AgentConfig): void {
  if (!config.localStorageEnabled) {
    console.log("[Storage] Local storage disabled");
    return;
  }

  const storagePath = config.localStoragePath;

  // Create storage directory if it doesn't exist
  if (!existsSync(storagePath)) {
    mkdirSync(storagePath, { recursive: true });
    console.log(`[Storage] Created storage directory: ${storagePath}`);
  }

  // Create per-camera subdirectories
  for (const camera of config.cameras) {
    const cameraDir = join(storagePath, camera.cameraId);
    if (!existsSync(cameraDir)) {
      mkdirSync(cameraDir, { recursive: true });
    }
  }

  console.log(`[Storage] Local storage initialized at ${storagePath}`);
  console.log(`[Storage] ${config.cameras.length} camera directories ready`);

  // In production, start FFmpeg recording processes here:
  //
  // for (const camera of config.cameras) {
  //   const outputPath = join(storagePath, camera.cameraId, `%Y%m%d_%H%M%S.mp4`);
  //   spawn('ffmpeg', [
  //     '-rtsp_transport', 'tcp',
  //     '-i', camera.rtspUrl,
  //     '-c', 'copy',
  //     '-f', 'segment',
  //     '-segment_time', '300',  // 5-minute segments
  //     '-strftime', '1',
  //     outputPath,
  //   ]);
  // }
}

/**
 * Clean up old recordings based on retention policy.
 * Would be called periodically (e.g., daily via setInterval).
 */
export function cleanupOldRecordings(
  storagePath: string,
  retentionDays: number
): void {
  console.log(
    `[Storage] Cleanup: removing recordings older than ${retentionDays} days`
  );
  // In production:
  // 1. Walk the storage directory
  // 2. Check file timestamps
  // 3. Delete files older than retentionDays
}

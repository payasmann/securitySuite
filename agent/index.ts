import { startHealthPing } from "./healthPing";
import { startStreamBridge } from "./streamBridge";
import { startMotionDetect, stopMotionDetect } from "./motionDetect";
import { initLocalStorage, stopAllRecordings } from "./storage";
import { initCentralSync, stopCentralSync } from "./centralSync";

// Load environment
const config = {
  apiUrl: process.env.API_URL || "http://localhost:3000",
  schoolId: process.env.SCHOOL_ID || "",
  apiKey: process.env.API_KEY || "",
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || "30000"),
  cameras: parseCameras(process.env.CAMERAS || ""),
  mediamtxPath: process.env.MEDIAMTX_PATH || "",
  mediamtxConfig: process.env.MEDIAMTX_CONFIG || "",
  localStoragePath: process.env.LOCAL_STORAGE_PATH || "./recordings",
  localStorageEnabled: process.env.LOCAL_STORAGE_ENABLED === "true",
  transcodeEnabled: process.env.TRANSCODE_ENABLED !== "false", // default true
  nvencEnabled: process.env.NVENC_ENABLED !== "false", // default true
  transcodeBitrate: parseInt(process.env.TRANSCODE_BITRATE || "4000"),
  agentPublicUrl: process.env.AGENT_PUBLIC_URL || "",
  retentionDays: parseInt(process.env.RETENTION_DAYS || "14"),
  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
};

/**
 * Parse the CAMERAS environment variable.
 *
 * Format per camera: cameraId:rtspUrl[:onvifUser:onvifPassword]
 * Multiple cameras are comma-separated.
 *
 * Examples:
 *   CAM-01:rtsp://192.168.1.100:554/stream1:admin:password123
 *   CAM-02:rtsp://192.168.1.102:554/stream1
 *
 * The RTSP URL contains colons (protocol, port) so we can't naively split
 * the whole string. Strategy: the URL always contains a "/" after the host:port.
 * ONVIF credentials (if present) are the last two colon-separated fields
 * after the final path segment.
 */
function parseCameras(
  str: string
): Array<{
  cameraId: string;
  rtspUrl: string;
  onvifUser?: string;
  onvifPassword?: string;
}> {
  if (!str) return [];

  return str.split(",").map((entry) => {
    const trimmed = entry.trim();

    // cameraId is everything before the first colon
    const firstColon = trimmed.indexOf(":");
    if (firstColon === -1) {
      return { cameraId: trimmed, rtspUrl: "" };
    }

    const cameraId = trimmed.slice(0, firstColon).trim();
    const rest = trimmed.slice(firstColon + 1).trim();

    // The RTSP URL ends with a path (e.g. /stream1, /h264, /1).
    // ONVIF credentials come after that path segment as :user:pass.
    // We find the last "/" in the URL — everything after it that matches
    // /pathSegment:user:pass gets split.
    const lastSlashIdx = rest.lastIndexOf("/");
    if (lastSlashIdx > -1) {
      const afterPath = rest.slice(lastSlashIdx);
      // Match: /pathSegment:onvifUser:onvifPassword
      // pathSegment has no colons; user and password are non-empty, no colons
      const credMatch = afterPath.match(/^(\/[^:]*):([^:]+):(.+)$/);
      if (credMatch) {
        const rtspUrl = rest.slice(0, lastSlashIdx) + credMatch[1];
        return {
          cameraId,
          rtspUrl,
          onvifUser: credMatch[2],
          onvifPassword: credMatch[3],
        };
      }
    }

    // No ONVIF credentials — entire rest is the RTSP URL (old format)
    return { cameraId, rtspUrl: rest };
  });
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  InfoSec Agent — On-Premises Security");
  console.log("═══════════════════════════════════════════");
  console.log(`  School ID:  ${config.schoolId}`);
  console.log(`  API URL:    ${config.apiUrl}`);
  console.log(`  Cameras:    ${config.cameras.length}`);
  console.log(`  Heartbeat:  ${config.heartbeatInterval}ms`);
  console.log(
    `  Transcode:  ${config.transcodeEnabled ? "enabled" : "disabled"} (NVENC: ${config.nvencEnabled ? "allowed" : "disabled"}, bitrate: ${config.transcodeBitrate} kbps)`
  );
  console.log(
    `  Storage:    ${config.localStorageEnabled ? `enabled (${config.localStoragePath}, ${config.retentionDays}d retention, ffmpeg: ${config.ffmpegPath})` : "disabled"}`
  );
  console.log(`  Public URL: ${config.agentPublicUrl || "(not set)"}`);
  console.log(`  Central NVR: ${process.env.CENTRAL_SERVER_URL || "(disabled)"}`);
  console.log("═══════════════════════════════════════════\n");

  if (!config.agentPublicUrl) {
    console.warn(
      "[Agent] WARNING: AGENT_PUBLIC_URL not set — browsers will use cloud proxy fallback for video"
    );
  }

  if (!config.schoolId || !config.apiKey) {
    console.error("ERROR: SCHOOL_ID and API_KEY must be set in environment");
    process.exit(1);
  }

  // Start health ping (heartbeat to cloud API)
  startHealthPing(config);

  // Start stream bridge manager (MediaMTX process)
  if (config.mediamtxPath) {
    await startStreamBridge(config);
  } else {
    console.log("[StreamBridge] MediaMTX path not configured, skipping");
  }

  // Start motion detection listener (ONVIF event subscriptions)
  await startMotionDetect(config);

  // Start local recording (after stream bridge is running)
  initLocalStorage(config);

  // Start central NVR sync (uploads local recordings to central server)
  // Only activates if CENTRAL_SERVER_URL is set — otherwise does nothing
  initCentralSync(config);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[Agent] Shutting down...");
    stopMotionDetect();
    stopAllRecordings();
    stopCentralSync();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n[Agent] Terminated");
    stopMotionDetect();
    stopAllRecordings();
    stopCentralSync();
    process.exit(0);
  });

  console.log("[Agent] All services started\n");
}

main().catch((err) => {
  console.error("[Agent] Fatal error:", err);
  process.exit(1);
});

export type AgentConfig = typeof config;

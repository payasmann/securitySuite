import { startHealthPing } from "./healthPing";
import { startStreamBridge } from "./streamBridge";
import { startMotionDetect } from "./motionDetect";

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
};

function parseCameras(str: string): Array<{ cameraId: string; rtspUrl: string }> {
  if (!str) return [];
  return str.split(",").map((pair) => {
    const [cameraId, ...urlParts] = pair.trim().split(":");
    return {
      cameraId: cameraId.trim(),
      rtspUrl: urlParts.join(":").trim(),
    };
  });
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  InfoSec Agent — On-Premises Security");
  console.log("═══════════════════════════════════════════");
  console.log(`  School ID: ${config.schoolId}`);
  console.log(`  API URL:   ${config.apiUrl}`);
  console.log(`  Cameras:   ${config.cameras.length}`);
  console.log(`  Heartbeat: ${config.heartbeatInterval}ms`);
  console.log("═══════════════════════════════════════════\n");

  if (!config.schoolId || !config.apiKey) {
    console.error("ERROR: SCHOOL_ID and API_KEY must be set in environment");
    process.exit(1);
  }

  // Start health ping (heartbeat to cloud API)
  startHealthPing(config);

  // Start stream bridge manager (MediaMTX process)
  if (config.mediamtxPath) {
    startStreamBridge(config);
  } else {
    console.log("[StreamBridge] MediaMTX path not configured, skipping");
  }

  // Start motion detection listener
  startMotionDetect(config);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[Agent] Shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n[Agent] Terminated");
    process.exit(0);
  });

  console.log("[Agent] All services started\n");
}

main().catch((err) => {
  console.error("[Agent] Fatal error:", err);
  process.exit(1);
});

export type AgentConfig = typeof config;

import { spawn, execSync, type ChildProcess } from "child_process";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import type { AgentConfig } from "./index";

let mediamtxProcess: ChildProcess | null = null;
let restartCount = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let stabilityTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_RESTART_DELAY = 60000; // 1 minute max

// Cached NVENC detection result — determined once at startup
let nvencAvailable: boolean | null = null;

/**
 * Resolved video encoder settings based on config + GPU detection.
 */
interface VideoEncoderSettings {
  videoEncoder: string;
  videoCodec: string;
  videoProfile: string;
  videoPreset: string;
  videoBitrate: number | null;
}

/**
 * Detect whether an NVIDIA GPU with NVENC is available by running `nvidia-smi`.
 * Result is cached after the first call.
 */
function detectNvenc(): boolean {
  if (nvencAvailable !== null) return nvencAvailable;

  try {
    execSync("nvidia-smi", { timeout: 5000, stdio: "ignore" });
    nvencAvailable = true;
  } catch {
    nvencAvailable = false;
  }

  return nvencAvailable;
}

/**
 * Determine video encoder settings from config and GPU availability.
 */
function resolveVideoEncoder(config: AgentConfig): VideoEncoderSettings {
  if (!config.transcodeEnabled) {
    return {
      videoEncoder: "copy",
      videoCodec: "",
      videoProfile: "",
      videoPreset: "",
      videoBitrate: null,
    };
  }

  const useNvenc = config.nvencEnabled && detectNvenc();

  if (useNvenc) {
    return {
      videoEncoder: "h264",
      videoCodec: "h264_nvenc",
      videoProfile: "baseline",
      videoPreset: "p2",
      videoBitrate: config.transcodeBitrate,
    };
  }

  // Software fallback
  return {
    videoEncoder: "h264",
    videoCodec: "libx264",
    videoProfile: "baseline",
    videoPreset: "ultrafast",
    videoBitrate: config.transcodeBitrate,
  };
}

/**
 * Log which video encoder will be used.
 */
function logEncoderChoice(config: AgentConfig): void {
  if (!config.transcodeEnabled) {
    console.log(
      "[StreamBridge] Video encoder: copy (transcoding disabled)"
    );
    return;
  }

  const useNvenc = config.nvencEnabled && detectNvenc();

  if (useNvenc) {
    console.log(
      "[StreamBridge] Video encoder: h264_nvenc (NVIDIA GPU detected)"
    );
  } else {
    console.log(
      "[StreamBridge] Video encoder: libx264 (software fallback — NVENC not available)"
    );
  }
}

/**
 * Generate a MediaMTX YAML configuration string from the agent config.
 * Audio passthrough is enabled via `audioEncoder: copy` on every camera path.
 * Video encoding is determined by transcoding config and GPU availability.
 */
function generateMediaMTXConfig(
  config: AgentConfig
): string {
  const header = [
    "# Auto-generated MediaMTX configuration",
    "# Do not edit manually — regenerated on agent startup",
    "",
    "logLevel: info",
    "logDestinations: [stdout]",
    "",
    "api: yes",
    "apiAddress: :9997",
    "",
    "rtsp: yes",
    "rtspAddress: :8554",
    "",
    "webrtc: yes",
    "webrtcAddress: :8889",
    "",
    "paths:",
  ];

  if (config.cameras.length === 0) {
    // No cameras — leave paths empty with a placeholder comment
    header.push("  # No cameras configured");
    return header.join("\n") + "\n";
  }

  const encoder = resolveVideoEncoder(config);

  const pathEntries = config.cameras.map((cam) => {
    const lines = [
      `  ${cam.cameraId}:`,
      `    source: ${cam.rtspUrl}`,
      `    sourceProtocol: tcp`,
      `    videoEncoder: ${encoder.videoEncoder}`,
    ];

    // Only include codec/profile/preset/bitrate when actually transcoding
    if (encoder.videoEncoder !== "copy") {
      lines.push(`    videoCodec: ${encoder.videoCodec}`);
      lines.push(`    videoProfile: ${encoder.videoProfile}`);
      lines.push(`    videoPreset: ${encoder.videoPreset}`);
      if (encoder.videoBitrate !== null) {
        lines.push(`    videoBitrate: ${encoder.videoBitrate}`);
      }
    }

    lines.push(`    audioEncoder: copy`);

    return lines.join("\n");
  });

  return header.join("\n") + "\n" + pathEntries.join("\n") + "\n";
}

/**
 * Write the generated config to disk and return the resolved path.
 */
function writeConfig(config: AgentConfig): string {
  const configPath = config.mediamtxConfig
    ? resolve(config.mediamtxConfig)
    : resolve("./mediamtx-generated.yml");

  // Ensure the parent directory exists
  mkdirSync(dirname(configPath), { recursive: true });

  const yaml = generateMediaMTXConfig(config);
  writeFileSync(configPath, yaml, "utf-8");
  console.log(`[StreamBridge] Wrote MediaMTX config to ${configPath}`);
  console.log(
    `[StreamBridge] Configured ${config.cameras.length} camera path(s) with audio passthrough`
  );

  return configPath;
}

function clearTimers(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (stabilityTimer) {
    clearTimeout(stabilityTimer);
    stabilityTimer = null;
  }
}

function startMediaMTX(config: AgentConfig): void {
  if (!config.mediamtxPath) return;

  // Generate config before every start so it picks up any camera changes
  const configPath = writeConfig(config);

  console.log("[StreamBridge] Starting MediaMTX...");

  mediamtxProcess = spawn(config.mediamtxPath, [configPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  mediamtxProcess.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[MediaMTX] ${line}`);
  });

  mediamtxProcess.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.error(`[MediaMTX ERR] ${line}`);
  });

  mediamtxProcess.on("exit", (code, signal) => {
    console.warn(
      `[StreamBridge] MediaMTX exited (code: ${code}, signal: ${signal})`
    );
    mediamtxProcess = null;

    // Auto-restart with exponential backoff
    restartCount++;
    const delay = Math.min(
      1000 * Math.pow(2, restartCount - 1),
      MAX_RESTART_DELAY
    );
    console.log(
      `[StreamBridge] Restarting in ${delay}ms (attempt #${restartCount})`
    );

    restartTimer = setTimeout(() => startMediaMTX(config), delay);
  });

  mediamtxProcess.on("error", (err) => {
    console.error("[StreamBridge] Failed to start MediaMTX:", err.message);
    mediamtxProcess = null;
  });

  // Reset restart counter after a stable run (2 minutes)
  stabilityTimer = setTimeout(() => {
    if (mediamtxProcess) {
      restartCount = 0;
    }
  }, 120_000);
}

/**
 * Detect GPU availability (once), log encoder choice, then start MediaMTX.
 */
export async function startStreamBridge(config: AgentConfig): Promise<void> {
  // Run NVENC detection once at startup and cache the result
  detectNvenc();

  // Log the encoder that will be used for all camera paths
  logEncoderChoice(config);

  // Log WHEP endpoint URLs for each camera
  const whepBase = config.agentPublicUrl || "http://localhost:8889";
  for (const cam of config.cameras) {
    console.log(`[StreamBridge] WHEP endpoint: ${whepBase}/${cam.cameraId}/whep`);
  }

  startMediaMTX(config);
}

export function stopStreamBridge(): void {
  clearTimers();

  if (mediamtxProcess) {
    console.log("[StreamBridge] Stopping MediaMTX...");
    mediamtxProcess.kill("SIGTERM");
    mediamtxProcess = null;
  }
}

export function restartStreamBridge(config: AgentConfig): void {
  stopStreamBridge();
  restartTimer = setTimeout(() => startMediaMTX(config), 1000);
}

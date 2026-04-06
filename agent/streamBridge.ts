import { spawn, type ChildProcess } from "child_process";
import type { AgentConfig } from "./index";

let mediamtxProcess: ChildProcess | null = null;
let restartCount = 0;
const MAX_RESTART_DELAY = 60000; // 1 minute max

function startMediaMTX(config: AgentConfig): void {
  if (!config.mediamtxPath) return;

  console.log("[StreamBridge] Starting MediaMTX...");

  const args = config.mediamtxConfig ? [config.mediamtxConfig] : [];
  mediamtxProcess = spawn(config.mediamtxPath, args, {
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
    const delay = Math.min(1000 * Math.pow(2, restartCount - 1), MAX_RESTART_DELAY);
    console.log(`[StreamBridge] Restarting in ${delay}ms (attempt #${restartCount})`);

    setTimeout(() => startMediaMTX(config), delay);
  });

  mediamtxProcess.on("error", (err) => {
    console.error("[StreamBridge] Failed to start MediaMTX:", err.message);
    mediamtxProcess = null;
  });

  // Reset restart counter after stable run (2 minutes)
  setTimeout(() => {
    if (mediamtxProcess) {
      restartCount = 0;
    }
  }, 120000);
}

export function startStreamBridge(config: AgentConfig): void {
  startMediaMTX(config);
}

export function stopStreamBridge(): void {
  if (mediamtxProcess) {
    console.log("[StreamBridge] Stopping MediaMTX...");
    mediamtxProcess.kill("SIGTERM");
    mediamtxProcess = null;
  }
}

export function restartStreamBridge(config: AgentConfig): void {
  stopStreamBridge();
  setTimeout(() => startMediaMTX(config), 1000);
}

import type { AgentConfig } from "./index";
import { getRecordingStatus, getDiskUsageGB } from "./storage";

interface CameraStatus {
  cameraId: string;
  status: "ONLINE" | "OFFLINE" | "WARNING";
  rtspReachable: boolean;
}

// Track camera reachability
const cameraStates = new Map<string, boolean>();

async function checkRtspReachable(rtspUrl: string): Promise<boolean> {
  // Simple TCP connection check to the RTSP port
  try {
    const url = new URL(rtspUrl);
    const { hostname, port } = url;
    const net = await import("net");

    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);

      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(parseInt(port || "554"), hostname);
    });
  } catch {
    return false;
  }
}

async function sendHeartbeat(config: AgentConfig): Promise<void> {
  // Check each camera's RTSP reachability
  const cameraStatuses: CameraStatus[] = [];

  for (const camera of config.cameras) {
    const reachable = await checkRtspReachable(camera.rtspUrl);
    const wasReachable = cameraStates.get(camera.cameraId);

    cameraStates.set(camera.cameraId, reachable);

    // Log status changes
    if (wasReachable !== undefined && wasReachable !== reachable) {
      console.log(
        `[Health] ${camera.cameraId} ${reachable ? "RECOVERED" : "UNREACHABLE"}`
      );
    }

    cameraStatuses.push({
      cameraId: camera.cameraId,
      status: reachable ? "ONLINE" : "OFFLINE",
      rtspReachable: reachable,
    });
  }

  // Gather recording status
  const recordingStatus = getRecordingStatus();
  const diskUsageGB = getDiskUsageGB();

  const payload: Record<string, unknown> = {
    schoolId: config.schoolId,
    apiKey: config.apiKey,
    cameras: cameraStatuses,
    bridgeOnline: true,
    timestamp: new Date().toISOString(),
    recording: {
      activeRecordings: recordingStatus.activeRecordings,
      recordingCameras: recordingStatus.cameras,
      diskUsageGB,
    },
  };

  // Include public URL for direct agent-to-browser WebRTC connections
  if (config.agentPublicUrl) {
    payload.publicUrl = config.agentPublicUrl;
  }

  try {
    const res = await fetch(`${config.apiUrl}/api/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error(`[Health] Heartbeat failed (${res.status}):`, data.error || "Unknown error");
    } else {
      const data = await res.json();
      console.log(
        `[Health] Heartbeat OK — ${data.processed} cameras, ${data.staleDetected} stale`
      );
    }
  } catch (error) {
    console.error("[Health] Network error:", (error as Error).message);
  }
}

export function startHealthPing(config: AgentConfig): void {
  console.log(`[Health] Starting heartbeat every ${config.heartbeatInterval}ms`);

  // Initial ping
  sendHeartbeat(config);

  // Recurring ping with exponential backoff on failure
  let consecutiveFailures = 0;

  setInterval(async () => {
    try {
      await sendHeartbeat(config);
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures++;
      const backoffMs = Math.min(
        config.heartbeatInterval * Math.pow(2, consecutiveFailures),
        300000 // Max 5 minutes
      );
      console.warn(
        `[Health] Retry in ${backoffMs}ms (failure #${consecutiveFailures})`
      );
    }
  }, config.heartbeatInterval);
}

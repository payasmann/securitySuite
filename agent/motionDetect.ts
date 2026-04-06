import type { AgentConfig } from "./index";

/**
 * ONVIF-based motion detection for cameras.
 *
 * Connects to each camera's ONVIF service, subscribes to motion alarm events,
 * and POSTs detected motion to the cloud API. Cameras without ONVIF credentials
 * or that don't support ONVIF events are silently skipped — RTSP streaming
 * continues to work regardless.
 */

// Motion-related ONVIF topics we listen for
const MOTION_TOPICS = [
  "RuleEngine/CellMotionDetector/Motion",
  "RuleEngine/MotionRegionDetector/Motion",
  "VideoAnalytics/Motion",
  "VideoSource/MotionAlarm",
  "Device/Trigger/DigitalInput",
];

// Debounce window per camera (ms)
const DEBOUNCE_MS = 10_000;

// Rate-limit tracking: cameraId -> list of timestamps
const lastMotionTimestamps: Map<string, number> = new Map();

// Track active ONVIF camera connections for cleanup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const activeCams: Array<any> = [];
let stopped = false;

/**
 * Wrap the callback-based `Cam` constructor in a Promise.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function connectCamera(opts: { hostname: string; port: number; username: string; password: string }): Promise<any> {
  // Dynamic import so the module is optional at runtime
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Cam } = require("onvif");

  return new Promise((resolve, reject) => {
    const cam = new Cam(
      {
        hostname: opts.hostname,
        port: opts.port,
        username: opts.username,
        password: opts.password,
      },
      (err: Error | null) => {
        if (err) return reject(err);
        resolve(cam);
      }
    );
  });
}

/**
 * Extract the hostname (IP) from an RTSP URL.
 * e.g. rtsp://192.168.1.100:554/stream1 → 192.168.1.100
 */
function extractHostFromRtsp(rtspUrl: string): string | null {
  try {
    // Replace rtsp:// with http:// so URL parser works
    const url = new URL(rtspUrl.replace(/^rtsp:\/\//, "http://"));
    return url.hostname || null;
  } catch {
    return null;
  }
}

/**
 * Check if an ONVIF event topic is motion-related.
 */
function isMotionTopic(topicString: string): boolean {
  if (!topicString) return false;
  return MOTION_TOPICS.some((t) => topicString.includes(t));
}

/**
 * POST a motion event to the cloud API.
 */
async function reportMotion(
  config: AgentConfig,
  cameraId: string
): Promise<void> {
  const url = `${config.apiUrl}/api/motion`;
  const body = JSON.stringify({
    cameraId,
    schoolId: config.schoolId,
    timestamp: new Date().toISOString(),
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-School-ID": config.schoolId,
        "X-API-Key": config.apiKey,
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[Motion] Cloud API responded ${res.status}: ${text}`);
    }
  } catch (err) {
    console.warn(`[Motion] Failed to report motion for ${cameraId}:`, err);
  }
}

/**
 * Debounce check — returns true if enough time has passed since the last
 * motion event for this camera.
 */
function shouldReport(cameraId: string): boolean {
  const now = Date.now();
  const last = lastMotionTimestamps.get(cameraId) ?? 0;
  if (now - last < DEBOUNCE_MS) return false;
  lastMotionTimestamps.set(cameraId, now);
  return true;
}

/**
 * Start ONVIF motion detection for all configured cameras.
 */
export async function startMotionDetect(config: AgentConfig): Promise<void> {
  stopped = false;
  console.log("[Motion] Motion detection listener started");
  console.log(`[Motion] Monitoring ${config.cameras.length} cameras`);

  for (const camera of config.cameras) {
    // Skip cameras without ONVIF credentials
    if (!camera.onvifUser || !camera.onvifPassword) {
      console.log(
        `[Motion] ${camera.cameraId}: no ONVIF credentials, skipping ONVIF subscription`
      );
      continue;
    }

    const hostname = extractHostFromRtsp(camera.rtspUrl);
    if (!hostname) {
      console.warn(
        `[Motion] ${camera.cameraId}: could not parse hostname from RTSP URL, skipping`
      );
      continue;
    }

    // Default ONVIF port is 80
    const onvifPort = 80;

    try {
      console.log(
        `[Motion] ${camera.cameraId}: connecting to ONVIF at ${hostname}:${onvifPort}...`
      );

      const cam = await connectCamera({
        hostname,
        port: onvifPort,
        username: camera.onvifUser,
        password: camera.onvifPassword,
      });

      if (stopped) return;

      activeCams.push(cam);

      console.log(
        `[Motion] ${camera.cameraId}: ONVIF connected, subscribing to events`
      );

      // Subscribe to events
      cam.on("event", (event: Record<string, unknown>) => {
        if (stopped) return;

        try {
          // Extract topic string — the ONVIF library puts it in various places
          // depending on the version and camera
          const topicValue =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (event as any)?.topic?._ ||
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (event as any)?.topic ||
            "";

          const topicStr = typeof topicValue === "string" ? topicValue : String(topicValue);

          if (!isMotionTopic(topicStr)) return;

          // Some cameras send IsMotion = true/false — check for false to avoid
          // reporting "motion stopped" events
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const simpleItem = (event as any)?.message?.message?.data?.simpleItem;
            if (simpleItem) {
              const items = Array.isArray(simpleItem) ? simpleItem : [simpleItem];
              for (const item of items) {
                const val = item?.$?.Value ?? item?.value ?? item?.Value;
                if (
                  val === false ||
                  val === "false" ||
                  val === "0" ||
                  val === 0
                ) {
                  // Motion ended — skip
                  return;
                }
              }
            }
          } catch {
            // If we can't parse simpleItem, still report the event
          }

          // Debounce
          if (!shouldReport(camera.cameraId)) return;

          console.log(`[Motion] ${camera.cameraId}: motion detected (${topicStr})`);
          reportMotion(config, camera.cameraId);
        } catch (err) {
          console.warn(
            `[Motion] ${camera.cameraId}: error processing event:`,
            err
          );
        }
      });
    } catch (err) {
      // Camera doesn't support ONVIF or is unreachable — not fatal
      console.warn(
        `[Motion] ${camera.cameraId}: ONVIF connection failed (streaming still works):`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

/**
 * Stop all ONVIF event subscriptions and clean up.
 */
export function stopMotionDetect(): void {
  stopped = true;
  console.log("[Motion] Stopping motion detection...");

  for (const cam of activeCams) {
    try {
      // The onvif library cam objects are EventEmitters — remove listeners
      cam.removeAllListeners("event");
    } catch {
      // Ignore cleanup errors
    }
  }

  activeCams.length = 0;
  lastMotionTimestamps.clear();
  console.log("[Motion] Motion detection stopped");
}

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { compare } from "bcryptjs";
import { emitMotionDetected } from "@/lib/socket";

interface MotionPayload {
  cameraId: string; // Display camera ID (e.g. "CAM-01"), not database cuid
  schoolId: string;
  timestamp: string;
  confidence?: number;
}

// In-memory rate tracking: cameraDatabaseId -> recent timestamps
const recentEvents: Map<string, number[]> = new Map();

// Rate-limit window (ms) and threshold for auto-alerting
const RATE_WINDOW_MS = 60_000;
const RATE_ALERT_THRESHOLD = 5;

/**
 * POST /api/motion
 *
 * Receives motion events from on-premises agents authenticated via
 * the school's StreamBridge API key.
 *
 * Headers:
 *   X-School-ID — the school CUID
 *   X-API-Key   — the agent's plaintext API key (compared against bcrypt hash)
 *
 * Body:
 *   { cameraId, schoolId, timestamp, confidence? }
 */
export async function POST(request: Request) {
  try {
    const schoolId = request.headers.get("X-School-ID");
    const apiKey = request.headers.get("X-API-Key");

    if (!schoolId || !apiKey) {
      return NextResponse.json(
        { error: "Missing X-School-ID or X-API-Key header" },
        { status: 400 }
      );
    }

    const body: MotionPayload = await request.json();

    if (!body.cameraId || !body.schoolId) {
      return NextResponse.json(
        { error: "Missing cameraId or schoolId in body" },
        { status: 400 }
      );
    }

    // Verify schoolId in header matches body
    if (schoolId !== body.schoolId) {
      return NextResponse.json(
        { error: "School ID mismatch between header and body" },
        { status: 400 }
      );
    }

    // Find the stream bridge for authentication
    const bridge = await prisma.streamBridge.findUnique({
      where: { schoolId },
      select: { id: true, apiKey: true },
    });

    if (!bridge) {
      return NextResponse.json(
        { error: "Stream bridge not found for this school" },
        { status: 404 }
      );
    }

    // Verify API key (bcrypt compare)
    const isValidKey = await compare(apiKey, bridge.apiKey);
    if (!isValidKey) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    // Look up the camera by its display cameraId within this school
    const camera = await prisma.camera.findFirst({
      where: {
        schoolId,
        cameraId: body.cameraId,
      },
      select: { id: true, cameraId: true, name: true, zone: true },
    });

    if (!camera) {
      return NextResponse.json(
        { error: `Camera ${body.cameraId} not found for school ${schoolId}` },
        { status: 404 }
      );
    }

    // Create MotionEvent record
    const motionEvent = await prisma.motionEvent.create({
      data: {
        cameraId: camera.id, // database cuid
        schoolId,
        recordedAt: body.timestamp ? new Date(body.timestamp) : new Date(),
      },
    });

    // Emit real-time socket event
    emitMotionDetected({
      cameraId: body.cameraId,
      cameraDatabaseId: camera.id,
      cameraName: camera.name,
      zone: camera.zone,
      schoolId,
      timestamp: motionEvent.recordedAt.toISOString(),
    });

    // Rate-limit tracking: auto-create WARNING alert if too many events
    const now = Date.now();
    const cameraKey = camera.id;

    if (!recentEvents.has(cameraKey)) {
      recentEvents.set(cameraKey, []);
    }
    const timestamps = recentEvents.get(cameraKey)!;

    // Prune old timestamps outside the window
    const cutoff = now - RATE_WINDOW_MS;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
    timestamps.push(now);

    // If threshold exceeded, create a warning alert
    if (timestamps.length >= RATE_ALERT_THRESHOLD) {
      await prisma.alert.create({
        data: {
          type: "WARNING",
          title: "Excessive motion detected",
          detail: `Camera ${body.cameraId} reported ${timestamps.length} motion events in the last 60 seconds`,
          cameraId: camera.id,
          schoolId,
        },
      });

      // Reset so we don't spam alerts every subsequent event
      recentEvents.set(cameraKey, []);
    }

    return NextResponse.json({
      status: "ok",
      eventId: motionEvent.id,
      timestamp: motionEvent.recordedAt.toISOString(),
    });
  } catch (error) {
    console.error("[Motion API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

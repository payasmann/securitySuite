import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { compare } from "bcryptjs";

interface HealthPayload {
  schoolId: string;
  apiKey: string;
  cameras: Array<{
    cameraId: string;
    status: "ONLINE" | "OFFLINE" | "WARNING";
    rtspReachable: boolean;
  }>;
  bridgeOnline: boolean;
  timestamp: string;
}

export async function POST(request: Request) {
  try {
    const body: HealthPayload = await request.json();

    if (!body.schoolId || !body.apiKey) {
      return NextResponse.json(
        { error: "Missing schoolId or apiKey" },
        { status: 400 }
      );
    }

    // Find the stream bridge for this school
    const bridge = await prisma.streamBridge.findUnique({
      where: { schoolId: body.schoolId },
      select: {
        id: true,
        apiKey: true,
        schoolId: true,
        school: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!bridge) {
      return NextResponse.json(
        { error: "Stream bridge not found for this school" },
        { status: 404 }
      );
    }

    // Verify API key
    const isValidKey = await compare(body.apiKey, bridge.apiKey);
    if (!isValidKey) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    const now = new Date();

    // Update bridge status
    await prisma.streamBridge.update({
      where: { id: bridge.id },
      data: {
        online: body.bridgeOnline,
        lastPingAt: now,
      },
    });

    // Update camera statuses
    if (body.cameras && body.cameras.length > 0) {
      for (const cam of body.cameras) {
        // Map agent status to DB status
        let dbStatus: "ONLINE" | "OFFLINE" | "WARNING" = cam.status;
        if (!cam.rtspReachable && cam.status === "ONLINE") {
          dbStatus = "WARNING";
        }

        // Find camera by cameraId (display ID) within this school
        const existingCamera = await prisma.camera.findFirst({
          where: {
            schoolId: body.schoolId,
            cameraId: cam.cameraId,
          },
          select: { id: true, status: true },
        });

        if (existingCamera) {
          const previousStatus = existingCamera.status;

          await prisma.camera.update({
            where: { id: existingCamera.id },
            data: {
              status: dbStatus,
              lastSeenAt: dbStatus !== "OFFLINE" ? now : undefined,
            },
          });

          // Generate alert if camera went offline
          if (previousStatus !== "OFFLINE" && dbStatus === "OFFLINE") {
            await prisma.alert.create({
              data: {
                type: "CRITICAL",
                title: "Camera offline",
                detail: `${cam.cameraId} has gone offline`,
                cameraId: existingCamera.id,
                schoolId: body.schoolId,
              },
            });
          }

          // Generate alert if camera recovered from offline
          if (previousStatus === "OFFLINE" && dbStatus === "ONLINE") {
            await prisma.alert.create({
              data: {
                type: "INFO",
                title: "Camera back online",
                detail: `${cam.cameraId} has recovered`,
                cameraId: existingCamera.id,
                schoolId: body.schoolId,
              },
            });
          }
        }
      }
    }

    // Check for cameras that missed heartbeats (>90s since lastSeenAt)
    const staleThreshold = new Date(now.getTime() - 90 * 1000);
    const staleCameras = await prisma.camera.findMany({
      where: {
        schoolId: body.schoolId,
        status: { not: "OFFLINE" },
        lastSeenAt: { lt: staleThreshold },
      },
      select: { id: true, cameraId: true, status: true },
    });

    for (const staleCam of staleCameras) {
      await prisma.camera.update({
        where: { id: staleCam.id },
        data: { status: "OFFLINE" },
      });

      await prisma.alert.create({
        data: {
          type: "CRITICAL",
          title: "Camera offline (missed heartbeats)",
          detail: `${staleCam.cameraId} missed 3 consecutive heartbeats`,
          cameraId: staleCam.id,
          schoolId: body.schoolId,
        },
      });
    }

    return NextResponse.json({
      status: "ok",
      processed: body.cameras?.length || 0,
      staleDetected: staleCameras.length,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("Health POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import type { Role } from "@prisma/client";
import { isOpsRole } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, schoolId: userSchoolId } = session.user;

    // Determine which school to show data for
    const { searchParams } = new URL(request.url);
    const querySchoolId = searchParams.get("schoolId");
    
    let schoolId: string | null = null;
    if (isOpsRole(role as Role)) {
      schoolId = querySchoolId || null;
    } else {
      schoolId = userSchoolId;
    }

    if (!schoolId) {
      return NextResponse.json(
        { error: "No school context. Provide schoolId parameter." },
        { status: 400 }
      );
    }

    // Verify school-scoped access
    if (!isOpsRole(role as Role) && schoolId !== userSchoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date();
    const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Run all queries in parallel
    const [
      cameras,
      activeAlerts,
      criticalAlerts,
      motionEvents,
      motionByCamera,
      recentAlerts,
    ] = await Promise.all([
      // Camera counts
      prisma.camera.findMany({
        where: { schoolId },
        select: { id: true, cameraId: true, name: true, zone: true, status: true },
      }),
      // Active (unresolved) alerts
      prisma.alert.count({
        where: { schoolId, resolved: false },
      }),
      // Critical alerts
      prisma.alert.count({
        where: { schoolId, resolved: false, type: "CRITICAL" },
      }),
      // Motion events in last 60 minutes
      prisma.motionEvent.aggregate({
        where: {
          schoolId,
          recordedAt: { gte: sixtyMinutesAgo },
        },
        _sum: { count: true },
      }),
      // Motion by camera (last 60 min, grouped)
      prisma.motionEvent.groupBy({
        by: ["cameraId"],
        where: {
          schoolId,
          recordedAt: { gte: sixtyMinutesAgo },
        },
        _sum: { count: true },
        orderBy: { _sum: { count: "desc" } },
        take: 5,
      }),
      // Recent alerts (last 10)
      prisma.alert.findMany({
        where: { schoolId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          type: true,
          title: true,
          detail: true,
          createdAt: true,
          camera: { select: { cameraId: true, name: true } },
        },
      }),
    ]);

    // Build camera lookup
    const cameraMap = new Map(cameras.map((c) => [c.id, c]));

    // Cameras online/total
    const camerasOnline = cameras.filter((c) => c.status === "ONLINE").length;
    const camerasTotal = cameras.length;

    // Total motion events
    const totalMotion = motionEvents._sum.count || 0;

    // Motion by camera with names
    const motionByCameraData = motionByCamera.map((m) => {
      const cam = cameraMap.get(m.cameraId);
      return {
        cameraId: cam?.cameraId || "Unknown",
        cameraName: cam?.name || "Unknown",
        count: m._sum.count || 0,
      };
    });

    // Zone status — derive from cameras and their alerts
    const zoneMap = new Map<string, { name: string; status: "Clear" | "Motion" | "Alert" }>();
    for (const camera of cameras) {
      const zone = camera.zone || camera.name;
      if (!zoneMap.has(zone)) {
        zoneMap.set(zone, { name: zone === "Entry" ? "Main Entrance" : camera.name, status: "Clear" });
      }
    }
    
    // Check for motion in zones (cameras with motion events)
    const motionCameraIds = new Set(motionByCamera.map((m) => m.cameraId));
    for (const camera of cameras) {
      if (motionCameraIds.has(camera.id)) {
        const zone = camera.zone || camera.name;
        const existing = zoneMap.get(zone);
        if (existing && existing.status === "Clear") {
          existing.status = "Motion";
        }
      }
      // Mark zones with WARNING/OFFLINE cameras as Alert
      if (camera.status === "WARNING" || camera.status === "OFFLINE") {
        const zone = camera.zone || camera.name;
        const existing = zoneMap.get(zone);
        if (existing) {
          existing.status = "Alert";
        }
      }
    }

    // Recent activity from alerts
    const recentActivity = recentAlerts.map((alert) => {
      const time = new Date(alert.createdAt).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const cameraInfo = alert.camera
        ? ` — ${alert.camera.name} (${alert.camera.cameraId})`
        : "";
      return {
        id: alert.id,
        time,
        type: alert.type === "CRITICAL" ? "critical" : alert.type === "WARNING" ? "warning" : "info",
        message: `${alert.title}${cameraInfo}`,
      };
    });

    // Storage estimate (placeholder — real implementation would query agent)
    const storageUsed = 68;
    const storageFree = "2.1TB";

    return NextResponse.json({
      stats: {
        camerasOnline,
        camerasTotal,
        activeAlerts,
        criticalAlerts,
        motionEvents: totalMotion,
        storageUsed,
        storageFree,
      },
      motionByCamera: motionByCameraData,
      zones: Array.from(zoneMap.values()),
      recentActivity,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

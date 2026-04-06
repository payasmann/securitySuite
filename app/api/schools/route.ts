import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import type { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!hasPermission(session.user.role as Role, "canViewAllSchools")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const schools = await prisma.school.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        address: true,
        createdAt: true,
        localStorageEnabled: true,
        cloudStorageEnabled: true,
        remoteAccessEnabled: true,
        localViewEnabled: true,
        retentionDays: true,
        maxCameras: true,
        maxUsers: true,
        _count: {
          select: {
            cameras: true,
            users: true,
            alerts: true,
          },
        },
        cameras: {
          select: { status: true },
        },
        streamBridge: {
          select: {
            online: true,
            lastPingAt: true,
          },
        },
      },
    });

    // Transform data for the frontend
    const schoolsData = schools.map((school) => {
      const camerasOnline = school.cameras.filter((c) => c.status === "ONLINE").length;
      const camerasTotal = school.cameras.length;

      return {
        id: school.id,
        name: school.name,
        slug: school.slug,
        address: school.address,
        createdAt: school.createdAt,
        flags: {
          localStorage: school.localStorageEnabled,
          cloudStorage: school.cloudStorageEnabled,
          remoteAccess: school.remoteAccessEnabled,
          localView: school.localViewEnabled,
        },
        limits: {
          retentionDays: school.retentionDays,
          maxCameras: school.maxCameras,
          maxUsers: school.maxUsers,
        },
        stats: {
          camerasOnline,
          camerasTotal,
          usersCount: school._count.users,
          alertsCount: school._count.alerts,
        },
        streamBridge: school.streamBridge
          ? {
              online: school.streamBridge.online,
              lastPingAt: school.streamBridge.lastPingAt,
            }
          : null,
      };
    });

    return NextResponse.json({ schools: schoolsData });
  } catch (error) {
    console.error("Schools GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

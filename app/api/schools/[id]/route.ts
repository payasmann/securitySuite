import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import type { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!hasPermission(session.user.role as Role, "canViewAllSchools")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const school = await prisma.school.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        address: true,
        ipRange: true,
        createdAt: true,
        localStorageEnabled: true,
        cloudStorageEnabled: true,
        remoteAccessEnabled: true,
        localViewEnabled: true,
        retentionDays: true,
        maxCameras: true,
        maxUsers: true,
        cameras: {
          select: {
            id: true,
            cameraId: true,
            name: true,
            zone: true,
            type: true,
            resolution: true,
            status: true,
            lastSeenAt: true,
          },
          orderBy: { cameraId: "asc" },
        },
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            active: true,
          },
        },
        alerts: {
          where: { resolved: false },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            type: true,
            title: true,
            createdAt: true,
            camera: { select: { cameraId: true, name: true } },
          },
        },
        streamBridge: {
          select: {
            online: true,
            lastPingAt: true,
            internalUrl: true,
            publicUrl: true,
          },
        },
      },
    });

    if (!school) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }

    return NextResponse.json({ school });
  } catch (error) {
    console.error("School GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

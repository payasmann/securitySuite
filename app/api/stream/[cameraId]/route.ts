import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import type { Role } from "@prisma/client";
import { isOpsRole, hasPermission } from "@/lib/permissions";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cameraId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, schoolId: userSchoolId } = session.user;

    // OPS_VIEWER cannot view live feeds
    if (!hasPermission(role as Role, "canViewLiveFeeds")) {
      return NextResponse.json(
        { error: "Your role does not have access to live feeds" },
        { status: 403 }
      );
    }

    const { cameraId } = await params;

    // Find camera by its database ID
    const camera = await prisma.camera.findUnique({
      where: { id: cameraId },
      select: {
        id: true,
        cameraId: true,
        name: true,
        status: true,
        schoolId: true,
        school: {
          select: {
            localViewEnabled: true,
            remoteAccessEnabled: true,
            streamBridge: {
              select: {
                publicUrl: true,
                internalUrl: true,
                online: true,
              },
            },
          },
        },
      },
    });

    if (!camera) {
      return NextResponse.json({ error: "Camera not found" }, { status: 404 });
    }

    // School-scoped access
    if (!isOpsRole(role as Role) && camera.schoolId !== userSchoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check feature flags
    if (!camera.school.localViewEnabled) {
      return NextResponse.json(
        {
          error: "Live viewing is disabled for this school",
          code: "LOCAL_VIEW_DISABLED",
        },
        { status: 403 }
      );
    }

    // Check remote access (if user is not on-prem)
    if (!camera.school.remoteAccessEnabled) {
      const forwardedFor = request.headers.get("x-forwarded-for");
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const clientIp = forwardedFor?.split(",")[0]?.trim() || "unknown";
      // For now, if remoteAccess is disabled, we return a flag
      // In production, you'd check against the school's ipRange
      return NextResponse.json({
        stream: null,
        remoteBlocked: true,
        message:
          "On-premises access only. Connect to the school network to view live feeds.",
      });
    }

    // Check stream bridge status
    const bridge = camera.school.streamBridge;
    if (!bridge || !bridge.online) {
      return NextResponse.json({
        stream: null,
        bridgeOffline: true,
        message: "Stream bridge is offline. Contact your administrator.",
      });
    }

    if (camera.status === "OFFLINE") {
      return NextResponse.json({
        stream: null,
        cameraOffline: true,
        message: "Camera is currently offline.",
      });
    }

    // Return the WebRTC stream URL (public URL for remote, internal for local)
    const streamUrl = bridge.publicUrl
      ? `${bridge.publicUrl}/${camera.cameraId}/whep`
      : `${bridge.internalUrl}/${camera.cameraId}/whep`;

    return NextResponse.json({
      stream: {
        url: streamUrl,
        cameraId: camera.cameraId,
        name: camera.name,
        status: camera.status,
      },
      remoteBlocked: false,
    });
  } catch (error) {
    console.error("Stream GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import type { Role } from "@prisma/client";
import { isOpsRole } from "@/lib/permissions";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const camera = await prisma.camera.findUnique({
      where: { id },
      select: {
        id: true,
        cameraId: true,
        name: true,
        zone: true,
        type: true,
        resolution: true,
        status: true,
        lastSeenAt: true,
        schoolId: true,
        createdAt: true,
      },
    });

    if (!camera) {
      return NextResponse.json({ error: "Camera not found" }, { status: 404 });
    }

    // School-scoped access check
    const { role, schoolId: userSchoolId } = session.user;
    if (!isOpsRole(role as Role) && camera.schoolId !== userSchoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ camera });
  } catch (error) {
    console.error("Camera GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

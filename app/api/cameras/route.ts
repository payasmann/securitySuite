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
    const { searchParams } = new URL(request.url);
    const querySchoolId = searchParams.get("schoolId");

    let schoolId: string | null;
    if (isOpsRole(role as Role)) {
      schoolId = querySchoolId || null;
    } else {
      schoolId = userSchoolId;
    }

    if (!schoolId) {
      return NextResponse.json({ error: "No school context" }, { status: 400 });
    }

    if (!isOpsRole(role as Role) && schoolId !== userSchoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const cameras = await prisma.camera.findMany({
      where: { schoolId },
      select: {
        id: true,
        cameraId: true,
        name: true,
        zone: true,
        type: true,
        resolution: true,
        status: true,
        lastSeenAt: true,
        createdAt: true,
        // NOTE: rtspUrl intentionally excluded — never sent to client
      },
      orderBy: { cameraId: "asc" },
    });

    return NextResponse.json({ cameras });
  } catch (error) {
    console.error("Cameras GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

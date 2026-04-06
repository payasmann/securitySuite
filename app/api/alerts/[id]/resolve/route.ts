import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import type { Role } from "@prisma/client";
import { hasPermission, isOpsRole } from "@/lib/permissions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, schoolId: userSchoolId } = session.user;

    if (!hasPermission(role as Role, "canResolveAlerts")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Find the alert
    const alert = await prisma.alert.findUnique({
      where: { id },
      select: { id: true, schoolId: true, resolved: true },
    });

    if (!alert) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    // School-scoped access check
    if (!isOpsRole(role as Role) && alert.schoolId !== userSchoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (alert.resolved) {
      return NextResponse.json({ message: "Alert already resolved", alert });
    }

    const updated = await prisma.alert.update({
      where: { id },
      data: { resolved: true },
      select: {
        id: true,
        type: true,
        title: true,
        detail: true,
        resolved: true,
        createdAt: true,
        camera: {
          select: { cameraId: true, name: true },
        },
      },
    });

    return NextResponse.json({ alert: updated });
  } catch (error) {
    console.error("Alert resolve error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

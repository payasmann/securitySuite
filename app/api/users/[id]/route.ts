import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import type { Role } from "@prisma/client";
import { hasPermission, isOpsRole, canManageRole } from "@/lib/permissions";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, schoolId: userSchoolId } = session.user;
    if (!hasPermission(role as Role, "canManageUsers")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, schoolId: true },
    });

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // School-scoped check
    if (!isOpsRole(role as Role) && target.schoolId !== userSchoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Cannot manage users of higher/different role group
    if (!canManageRole(role as Role, target.role)) {
      return NextResponse.json(
        { error: "Cannot modify this user" },
        { status: 403 }
      );
    }

    // Build update data (only allow safe fields)
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.active !== undefined) updateData.active = body.active;
    if (body.role !== undefined) {
      if (!canManageRole(role as Role, body.role as Role)) {
        return NextResponse.json(
          { error: `Cannot assign role ${body.role}` },
          { status: 403 }
        );
      }
      updateData.role = body.role;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("User PATCH error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, schoolId: userSchoolId } = session.user;
    if (!hasPermission(role as Role, "canManageUsers")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Cannot delete yourself
    if (id === session.user.id) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, schoolId: true },
    });

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!isOpsRole(role as Role) && target.schoolId !== userSchoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!canManageRole(role as Role, target.role)) {
      return NextResponse.json(
        { error: "Cannot delete this user" },
        { status: 403 }
      );
    }

    // Soft delete — deactivate instead of removing
    await prisma.user.update({
      where: { id },
      data: { active: false },
    });

    return NextResponse.json({ message: "User deactivated" });
  } catch (error) {
    console.error("User DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

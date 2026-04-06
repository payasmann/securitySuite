import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import type { Role } from "@prisma/client";
import { hasPermission } from "@/lib/permissions";
import { invalidateSchoolFlags } from "@/lib/feature-flags";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!hasPermission(session.user.role as Role, "canEditFeatureFlags")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Verify school exists
    const existing = await prisma.school.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }

    const body = await request.json();

    // Only allow updating specific fields
    const allowedFields = [
      "localStorageEnabled",
      "cloudStorageEnabled",
      "remoteAccessEnabled",
      "localViewEnabled",
      "retentionDays",
      "maxCameras",
      "maxUsers",
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        // Validate types
        if (field.endsWith("Enabled") && typeof body[field] !== "boolean") {
          return NextResponse.json(
            { error: `${field} must be a boolean` },
            { status: 400 }
          );
        }
        if (
          (field === "retentionDays" || field === "maxCameras" || field === "maxUsers") &&
          (typeof body[field] !== "number" || body[field] < 1)
        ) {
          return NextResponse.json(
            { error: `${field} must be a positive number` },
            { status: 400 }
          );
        }
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const school = await prisma.school.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        localStorageEnabled: true,
        cloudStorageEnabled: true,
        remoteAccessEnabled: true,
        localViewEnabled: true,
        retentionDays: true,
        maxCameras: true,
        maxUsers: true,
      },
    });

    invalidateSchoolFlags(id);

    return NextResponse.json({ school });
  } catch (error) {
    console.error("School settings PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

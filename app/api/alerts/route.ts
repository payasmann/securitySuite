import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import type { Role, AlertType } from "@prisma/client";
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
    const type = searchParams.get("type") as AlertType | null;
    const resolved = searchParams.get("resolved");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build where clause
    const where: Record<string, unknown> = {};

    if (isOpsRole(role as Role)) {
      // Ops can view all or filter by school
      if (querySchoolId) {
        where.schoolId = querySchoolId;
      }
    } else {
      // School users can only see their school
      if (!userSchoolId) {
        return NextResponse.json(
          { error: "No school context" },
          { status: 400 }
        );
      }
      where.schoolId = userSchoolId;
    }

    if (type) {
      where.type = type;
    }

    if (resolved !== null && resolved !== undefined) {
      where.resolved = resolved === "true";
    }

    const [alerts, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        orderBy: [
          { resolved: "asc" },
          { type: "asc" }, // CRITICAL first (alphabetical: CRITICAL < INFO < WARNING)
          { createdAt: "desc" },
        ],
        take: limit,
        skip: offset,
        select: {
          id: true,
          type: true,
          title: true,
          detail: true,
          resolved: true,
          createdAt: true,
          schoolId: true,
          camera: {
            select: {
              cameraId: true,
              name: true,
              zone: true,
            },
          },
        },
      }),
      prisma.alert.count({ where }),
    ]);

    return NextResponse.json({ alerts, total, limit, offset });
  } catch (error) {
    console.error("Alerts GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import { hash } from "bcryptjs";
import type { Role } from "@prisma/client";
import {
  hasPermission,
  isOpsRole,
  canManageRole,
  assignableRoles,
} from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, schoolId: userSchoolId } = session.user;

    // Must have user management permission
    if (
      !hasPermission(role as Role, "canManageUsers") &&
      !hasPermission(role as Role, "canManageAllUsers")
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const querySchoolId = searchParams.get("schoolId");

    const where: Record<string, unknown> = {};

    if (isOpsRole(role as Role)) {
      if (querySchoolId) {
        where.schoolId = querySchoolId;
      }
    } else {
      if (!userSchoolId) {
        return NextResponse.json(
          { error: "No school context" },
          { status: 400 }
        );
      }
      where.schoolId = userSchoolId;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
        school: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      users,
      assignableRoles: assignableRoles(role as Role),
    });
  } catch (error) {
    console.error("Users GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, schoolId: userSchoolId } = session.user;

    if (!hasPermission(role as Role, "canManageUsers")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { email, name, password, role: targetRole, schoolId } = body;

    if (!email || !name || !password || !targetRole) {
      return NextResponse.json(
        { error: "Missing required fields: email, name, password, role" },
        { status: 400 }
      );
    }

    // Validate target role
    if (!canManageRole(role as Role, targetRole as Role)) {
      return NextResponse.json(
        { error: `Cannot create user with role ${targetRole}` },
        { status: 403 }
      );
    }

    // Determine the school for the new user
    let newUserSchoolId: string | null = null;
    if (targetRole === "SCHOOL_ADMIN" || targetRole === "SCHOOL_VIEWER") {
      if (isOpsRole(role as Role)) {
        newUserSchoolId = schoolId || null;
      } else {
        newUserSchoolId = userSchoolId;
      }
      if (!newUserSchoolId) {
        return NextResponse.json(
          { error: "School ID required for school-level roles" },
          { status: 400 }
        );
      }

      // Check max users limit
      const school = await prisma.school.findUnique({
        where: { id: newUserSchoolId },
        select: { maxUsers: true },
      });
      if (school) {
        const currentCount = await prisma.user.count({
          where: { schoolId: newUserSchoolId, active: true },
        });
        if (currentCount >= school.maxUsers) {
          return NextResponse.json(
            {
              error: `Maximum user limit (${school.maxUsers}) reached for this school`,
            },
            { status: 400 }
          );
        }
      }
    }

    // Check email uniqueness
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    const hashedPassword = await hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        role: targetRole as Role,
        schoolId: newUserSchoolId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("Users POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

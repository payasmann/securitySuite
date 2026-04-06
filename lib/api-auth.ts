import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { Role } from "@prisma/client";
import {
  hasPermission,
  canAccessSchoolData,
  type Permission,
} from "@/lib/permissions";

/**
 * Get the authenticated session in an API route.
 * Returns null if not authenticated.
 */
export async function getApiSession() {
  const session = await auth();
  if (!session?.user) return null;
  return session;
}

/**
 * Require authentication in an API route.
 * Returns the session or a 401 response.
 */
export async function requireAuth() {
  const session = await getApiSession();
  if (!session) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, error: null };
}

/**
 * Require a specific permission in an API route.
 * Returns the session or a 403 response.
 */
export async function requireApiPermission(permission: keyof Permission) {
  const { session, error } = await requireAuth();
  if (error) return { session: null, error };

  if (!hasPermission(session!.user.role as Role, permission)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { session: session!, error: null };
}

/**
 * Require school access in an API route.
 * For ops roles, allows access to any school.
 * For school roles, only allows access to their own school.
 */
export async function requireSchoolApiAccess(schoolId: string) {
  const { session, error } = await requireAuth();
  if (error) return { session: null, error };

  const user = session!.user;
  if (!canAccessSchoolData(user.role as Role, user.schoolId, schoolId)) {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Forbidden: cannot access this school" },
        { status: 403 }
      ),
    };
  }

  return { session: session!, error: null };
}

/**
 * Get the effective schoolId for the current user.
 * For school users, returns their schoolId.
 * For ops users, returns the schoolId from the query parameter.
 * Returns null if no schoolId can be determined.
 */
export function getEffectiveSchoolId(
  userRole: Role,
  userSchoolId: string | null,
  querySchoolId?: string | null
): string | null {
  if (userRole === "SUPER_ADMIN" || userRole === "OPS_VIEWER") {
    return querySchoolId || null;
  }
  return userSchoolId;
}

import type { Session } from "next-auth";
import type { Role } from "@prisma/client";

export type AuthSession = Session & {
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    schoolId: string | null;
    active: boolean;
  };
};

export type SessionUser = AuthSession["user"];

// Helper to check if a role is ops-level (internal team)
export function isOpsRole(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "OPS_VIEWER";
}

// Helper to check if a role is school-level
export function isSchoolRole(role: Role): boolean {
  return role === "SCHOOL_ADMIN" || role === "SCHOOL_VIEWER";
}

// Helper to check if user can access a specific school's data
export function canAccessSchool(
  user: SessionUser,
  schoolId: string
): boolean {
  if (isOpsRole(user.role)) return true;
  return user.schoolId === schoolId;
}

// Helper to get the redirect path after login based on role
export function getDefaultRedirect(role: Role): string {
  switch (role) {
    case "SUPER_ADMIN":
    case "OPS_VIEWER":
      return "/ops/dashboard";
    case "SCHOOL_ADMIN":
    case "SCHOOL_VIEWER":
      return "/dashboard";
    default:
      return "/login";
  }
}

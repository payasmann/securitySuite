import { Role } from "@prisma/client";

// ─── Permission Definitions ──────────────────────────────

export interface Permission {
  // Portal access
  canAccessOpsPortal: boolean;
  canAccessSchoolPortal: boolean;

  // School management
  canManageSchools: boolean;
  canViewAllSchools: boolean;
  canEditFeatureFlags: boolean;

  // Camera operations
  canViewCameras: boolean;
  canManageCameras: boolean;
  canViewLiveFeeds: boolean;

  // Alert operations
  canViewAlerts: boolean;
  canResolveAlerts: boolean;
  canViewAllAlerts: boolean; // cross-school

  // User management
  canManageUsers: boolean;
  canManageAllUsers: boolean; // cross-school

  // Dashboard
  canViewDashboard: boolean;
  canViewOpsDashboard: boolean;
}

// ─── Role → Permission Map ───────────────────────────────

const ROLE_PERMISSIONS: Record<Role, Permission> = {
  SUPER_ADMIN: {
    canAccessOpsPortal: true,
    canAccessSchoolPortal: true,
    canManageSchools: true,
    canViewAllSchools: true,
    canEditFeatureFlags: true,
    canViewCameras: true,
    canManageCameras: true,
    canViewLiveFeeds: true,
    canViewAlerts: true,
    canResolveAlerts: true,
    canViewAllAlerts: true,
    canManageUsers: true,
    canManageAllUsers: true,
    canViewDashboard: true,
    canViewOpsDashboard: true,
  },
  OPS_VIEWER: {
    canAccessOpsPortal: true,
    canAccessSchoolPortal: false,
    canManageSchools: false,
    canViewAllSchools: true,
    canEditFeatureFlags: false,
    canViewCameras: true,
    canManageCameras: false,
    canViewLiveFeeds: false, // OPS_VIEWER cannot view live feeds
    canViewAlerts: true,
    canResolveAlerts: false,
    canViewAllAlerts: true,
    canManageUsers: false,
    canManageAllUsers: false,
    canViewDashboard: false,
    canViewOpsDashboard: true,
  },
  SCHOOL_ADMIN: {
    canAccessOpsPortal: false,
    canAccessSchoolPortal: true,
    canManageSchools: false,
    canViewAllSchools: false,
    canEditFeatureFlags: false,
    canViewCameras: true,
    canManageCameras: false, // read-only camera management
    canViewLiveFeeds: true,
    canViewAlerts: true,
    canResolveAlerts: true,
    canViewAllAlerts: false,
    canManageUsers: true, // within their school only
    canManageAllUsers: false,
    canViewDashboard: true,
    canViewOpsDashboard: false,
  },
  SCHOOL_VIEWER: {
    canAccessOpsPortal: false,
    canAccessSchoolPortal: true,
    canManageSchools: false,
    canViewAllSchools: false,
    canEditFeatureFlags: false,
    canViewCameras: true,
    canManageCameras: false,
    canViewLiveFeeds: true,
    canViewAlerts: true,
    canResolveAlerts: false,
    canViewAllAlerts: false,
    canManageUsers: false,
    canManageAllUsers: false,
    canViewDashboard: true,
    canViewOpsDashboard: false,
  },
};

// ─── Helper Functions ────────────────────────────────────

/**
 * Get the full permission set for a role
 */
export function getPermissions(role: Role): Permission {
  return ROLE_PERMISSIONS[role];
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(
  role: Role,
  permission: keyof Permission
): boolean {
  return ROLE_PERMISSIONS[role][permission];
}

/**
 * Check if a role is an ops-level role (internal team)
 */
export function isOpsRole(role: Role): boolean {
  return role === "SUPER_ADMIN" || role === "OPS_VIEWER";
}

/**
 * Check if a role is a school-level role
 */
export function isSchoolRole(role: Role): boolean {
  return role === "SCHOOL_ADMIN" || role === "SCHOOL_VIEWER";
}

/**
 * Check if a role can access a specific school's data
 */
export function canAccessSchoolData(
  role: Role,
  userSchoolId: string | null,
  targetSchoolId: string
): boolean {
  // Ops roles can access any school
  if (isOpsRole(role)) return true;
  // School roles can only access their own school
  return userSchoolId === targetSchoolId;
}

/**
 * Check if a role can manage users with a target role.
 * SCHOOL_ADMIN can only create/edit SCHOOL_ADMIN and SCHOOL_VIEWER.
 * SUPER_ADMIN can create/edit any role.
 */
export function canManageRole(
  managerRole: Role,
  targetRole: Role
): boolean {
  if (managerRole === "SUPER_ADMIN") return true;
  if (managerRole === "SCHOOL_ADMIN") {
    return targetRole === "SCHOOL_ADMIN" || targetRole === "SCHOOL_VIEWER";
  }
  return false;
}

/**
 * Get the roles that a manager role can assign
 */
export function assignableRoles(managerRole: Role): Role[] {
  if (managerRole === "SUPER_ADMIN") {
    return ["SUPER_ADMIN", "OPS_VIEWER", "SCHOOL_ADMIN", "SCHOOL_VIEWER"];
  }
  if (managerRole === "SCHOOL_ADMIN") {
    return ["SCHOOL_ADMIN", "SCHOOL_VIEWER"];
  }
  return [];
}

/**
 * Get the default redirect path after login based on role
 */
export function getLoginRedirect(role: Role): string {
  if (isOpsRole(role)) return "/ops/dashboard";
  return "/dashboard";
}

// ─── API Route Helpers ───────────────────────────────────

/**
 * Require a specific permission. Throws if not met.
 * Use in API routes: requirePermission(session.user.role, 'canManageUsers')
 */
export function requirePermission(
  role: Role,
  permission: keyof Permission
): void {
  if (!hasPermission(role, permission)) {
    throw new Error(
      `Forbidden: role ${role} does not have permission ${permission}`
    );
  }
}

/**
 * Require that the user can access a specific school.
 * Throws if the user is school-scoped and the IDs don't match.
 */
export function requireSchoolAccess(
  role: Role,
  userSchoolId: string | null,
  targetSchoolId: string
): void {
  if (!canAccessSchoolData(role, userSchoolId, targetSchoolId)) {
    throw new Error(
      `Forbidden: user cannot access school ${targetSchoolId}`
    );
  }
}

import prisma from "@/lib/db";

export interface SchoolFlags {
  localStorageEnabled: boolean;
  cloudStorageEnabled: boolean;
  remoteAccessEnabled: boolean;
  localViewEnabled: boolean;
  retentionDays: number;
  maxCameras: number;
  maxUsers: number;
}

/**
 * Get feature flags for a school.
 * Cached in memory for 60 seconds to reduce DB queries.
 */
const flagsCache = new Map<string, { flags: SchoolFlags; expiresAt: number }>();
const CACHE_TTL = 60 * 1000; // 60 seconds

export async function getSchoolFlags(schoolId: string): Promise<SchoolFlags | null> {
  // Check cache first
  const cached = flagsCache.get(schoolId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.flags;
  }

  try {
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        localStorageEnabled: true,
        cloudStorageEnabled: true,
        remoteAccessEnabled: true,
        localViewEnabled: true,
        retentionDays: true,
        maxCameras: true,
        maxUsers: true,
      },
    });

    if (!school) return null;

    const flags: SchoolFlags = {
      localStorageEnabled: school.localStorageEnabled,
      cloudStorageEnabled: school.cloudStorageEnabled,
      remoteAccessEnabled: school.remoteAccessEnabled,
      localViewEnabled: school.localViewEnabled,
      retentionDays: school.retentionDays,
      maxCameras: school.maxCameras,
      maxUsers: school.maxUsers,
    };

    // Cache the result
    flagsCache.set(schoolId, {
      flags,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return flags;
  } catch (error) {
    console.error("Error fetching school flags:", error);
    return null;
  }
}

/**
 * Clear cached flags for a school (call after updating settings)
 */
export function invalidateSchoolFlags(schoolId: string): void {
  flagsCache.delete(schoolId);
}

/**
 * Check if live viewing is enabled for a school
 */
export async function isLiveViewEnabled(schoolId: string): Promise<boolean> {
  const flags = await getSchoolFlags(schoolId);
  return flags?.localViewEnabled ?? false;
}

/**
 * Check if cloud storage is enabled for a school
 */
export async function isCloudStorageEnabled(schoolId: string): Promise<boolean> {
  const flags = await getSchoolFlags(schoolId);
  return flags?.cloudStorageEnabled ?? false;
}

/**
 * Check if remote access is enabled for a school
 */
export async function isRemoteAccessEnabled(schoolId: string): Promise<boolean> {
  const flags = await getSchoolFlags(schoolId);
  return flags?.remoteAccessEnabled ?? false;
}

/**
 * Check if adding more cameras is allowed (within maxCameras limit)
 */
export async function canAddCamera(schoolId: string): Promise<boolean> {
  const flags = await getSchoolFlags(schoolId);
  if (!flags) return false;

  const count = await prisma.camera.count({ where: { schoolId } });
  return count < flags.maxCameras;
}

/**
 * Check if adding more users is allowed (within maxUsers limit)
 */
export async function canAddUser(schoolId: string): Promise<boolean> {
  const flags = await getSchoolFlags(schoolId);
  if (!flags) return false;

  const count = await prisma.user.count({ where: { schoolId, active: true } });
  return count < flags.maxUsers;
}

/**
 * Check if the client IP is within the school's allowed IP range.
 * Used for remote access restriction.
 */
export function isIpInRange(clientIp: string, cidr: string | null): boolean {
  if (!cidr) return true; // No IP restriction configured

  try {
    const [rangeIp, prefixStr] = cidr.split("/");
    const prefix = parseInt(prefixStr, 10);

    if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

    const ipToNum = (ip: string): number => {
      const parts = ip.split(".").map(Number);
      return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
    };

    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const clientNum = ipToNum(clientIp);
    const rangeNum = ipToNum(rangeIp);

    return (clientNum & mask) === (rangeNum & mask);
  } catch {
    return false;
  }
}

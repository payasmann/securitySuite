import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isOpsRole, canAccessSchoolData } from "@/lib/permissions";
import type { Role } from "@prisma/client";
import fs from "fs";
import path from "path";

// ─── GET /api/recordings/[schoolId]/[cameraId]/[date] ────
// Lists available segments for a camera on a given date.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ schoolId: string; cameraId: string; date: string }> }
) {
  try {
    // Feature gate
    if (process.env.CENTRAL_INGEST_ENABLED !== "true") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ── Authentication ────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { schoolId, cameraId, date } = await params;
    const { role, schoolId: userSchoolId } = session.user;

    // ── School access check ───────────────────────────────
    const safeSchoolId = schoolId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!canAccessSchoolData(role as Role, userSchoolId, safeSchoolId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Validation ────────────────────────────────────────
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Invalid date format. Expected YYYY-MM-DD." },
        { status: 400 }
      );
    }

    const safeCameraId = cameraId.replace(/[^a-zA-Z0-9_-]/g, "");

    // ── List segments ─────────────────────────────────────
    const storagePath =
      process.env.CENTRAL_STORAGE_PATH || "./central-recordings";
    const dirPath = path.join(storagePath, safeSchoolId, safeCameraId, date);

    if (!fs.existsSync(dirPath)) {
      return NextResponse.json({
        schoolId: safeSchoolId,
        cameraId: safeCameraId,
        date,
        segments: [],
      });
    }

    const entries = fs.readdirSync(dirPath);
    const segments = entries
      .filter(
        (name) => name.startsWith("segment_") && name.endsWith(".mp4") && !name.endsWith(".tmp")
      )
      .sort()
      .map((name) => {
        const filePath = path.join(dirPath, name);
        const stat = fs.statSync(filePath);
        return {
          name,
          size: stat.size,
          createdAt: stat.birthtime.toISOString(),
        };
      });

    return NextResponse.json({
      schoolId: safeSchoolId,
      cameraId: safeCameraId,
      date,
      segments,
    });
  } catch (error) {
    console.error("[Recordings] List error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

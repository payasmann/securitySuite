import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchoolData } from "@/lib/permissions";
import type { Role } from "@prisma/client";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

// ─── GET /api/recordings/[schoolId]/[cameraId]/[date]/[segment] ──
// Streams a specific MP4 file for playback with range request support.

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      schoolId: string;
      cameraId: string;
      date: string;
      segment: string;
    }>;
  }
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

    const { schoolId, cameraId, date, segment } = await params;
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

    if (!/^segment_\d{2}-\d{2}-\d{2}\.mp4$/.test(segment)) {
      return NextResponse.json(
        { error: "Invalid segment format. Expected segment_HH-MM-SS.mp4." },
        { status: 400 }
      );
    }

    const safeCameraId = cameraId.replace(/[^a-zA-Z0-9_-]/g, "");

    // ── File check ────────────────────────────────────────
    const storagePath =
      process.env.CENTRAL_STORAGE_PATH || "./central-recordings";
    const filePath = path.join(
      storagePath,
      safeSchoolId,
      safeCameraId,
      date,
      segment
    );

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "Segment not found" },
        { status: 404 }
      );
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;

    // ── Range request handling ────────────────────────────
    const rangeHeader = request.headers.get("Range");

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return new Response("Invalid Range header", {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        return new Response("Range not satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }

      const contentLength = end - start + 1;
      const nodeStream = fs.createReadStream(filePath, { start, end });
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    // ── Full file response ────────────────────────────────
    const nodeStream = fs.createReadStream(filePath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    console.error("[Recordings] Stream error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

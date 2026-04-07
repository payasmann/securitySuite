import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// ─── POST /api/recordings/ingest ─────────────────────────
// Receives MP4 segment uploads from remote agents.

export async function POST(request: Request) {
  try {
    // Feature gate
    if (process.env.CENTRAL_INGEST_ENABLED !== "true") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // ── Authentication ────────────────────────────────────
    const expectedKey = process.env.CENTRAL_INGEST_API_KEY;
    if (expectedKey) {
      const providedKey = request.headers.get("X-API-Key") || "";
      const expected = Buffer.from(expectedKey);
      const provided = Buffer.from(providedKey);

      if (
        expected.length !== provided.length ||
        !crypto.timingSafeEqual(expected, provided)
      ) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // ── Metadata from headers ─────────────────────────────
    const schoolId = request.headers.get("X-School-ID");
    const cameraId = request.headers.get("X-Camera-ID");
    const date = request.headers.get("X-Date");
    const segment = request.headers.get("X-Segment");

    if (!schoolId || !cameraId || !date || !segment) {
      return NextResponse.json(
        {
          error: "Missing required headers: X-School-ID, X-Camera-ID, X-Date, X-Segment",
        },
        { status: 400 }
      );
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

    // Sanitize IDs to prevent directory traversal
    const safeSchoolId = schoolId.replace(/[^a-zA-Z0-9_-]/g, "");
    const safeCameraId = cameraId.replace(/[^a-zA-Z0-9_-]/g, "");

    // ── Storage path ──────────────────────────────────────
    const storagePath =
      process.env.CENTRAL_STORAGE_PATH || "./central-recordings";
    const dirPath = path.join(storagePath, safeSchoolId, safeCameraId, date);
    const finalPath = path.join(dirPath, segment);
    const tmpPath = finalPath + ".tmp";

    // ── Duplicate check ───────────────────────────────────
    if (fs.existsSync(finalPath)) {
      return NextResponse.json(
        { status: "exists", message: "Segment already exists" },
        { status: 409 }
      );
    }

    // ── Write to disk ─────────────────────────────────────
    fs.mkdirSync(dirPath, { recursive: true });

    const body = request.body;
    if (!body) {
      return NextResponse.json(
        { error: "Request body is empty" },
        { status: 400 }
      );
    }

    try {
      const reader = body.getReader();
      const writeStream = fs.createWriteStream(tmpPath);

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const canContinue = writeStream.write(value);
          if (!canContinue) {
            await new Promise<void>((resolve) =>
              writeStream.once("drain", resolve)
            );
          }
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on("error", reject);
      });

      // Atomic rename from .tmp to final path
      fs.renameSync(tmpPath, finalPath);
    } catch (writeError) {
      // Clean up .tmp file on error
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      console.error("[Ingest] Write error:", writeError);
      return NextResponse.json(
        { error: "Failed to write segment" },
        { status: 500 }
      );
    }

    const relativePath = `${safeSchoolId}/${safeCameraId}/${date}/${segment}`;
    console.log(`[Ingest] Stored segment: ${relativePath}`);

    return NextResponse.json({ status: "ok", path: relativePath });
  } catch (error) {
    console.error("[Ingest] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

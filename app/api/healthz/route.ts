import { NextResponse } from "next/server";
import prisma from "@/lib/db";

// ─── GET /api/healthz ───────────────────────────────────────────────────────
// Cloud server health check endpoint for load balancers and uptime monitoring.
// Returns 200 if the server and database are reachable, 503 otherwise.
// ────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const started = Date.now();

  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "healthy",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db: "connected",
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        db: "disconnected",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}

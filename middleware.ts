import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default auth((req) => {
  const { nextUrl } = req;
  const { pathname } = nextUrl;
  const session = req.auth;

  // ─── Public routes (no auth required) ──────────────────
  // Agent-facing endpoints are public (authenticated via API key, not session)
  const publicPaths = [
    "/login",
    "/api/auth",
    "/api/health",
    "/api/v1/health",
    "/api/v1/motion",
    "/api/v1/recordings",
    "/api/healthz",
  ];
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));

  if (isPublicPath) {
    // If logged in and trying to access login, redirect to appropriate dashboard
    if (pathname.startsWith("/login") && session?.user) {
      const role = session.user.role;
      const redirect =
        role === "SUPER_ADMIN" || role === "OPS_VIEWER"
          ? "/ops/dashboard"
          : "/dashboard";
      return NextResponse.redirect(new URL(redirect, nextUrl));
    }
    return NextResponse.next();
  }

  // ─── Require authentication for all other routes ───────
  if (!session?.user) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const { role, schoolId, active } = session.user;

  // ─── Block inactive users ─────────────────────────────
  if (!active) {
    return NextResponse.redirect(new URL("/login?error=deactivated", nextUrl));
  }

  // ─── Root redirect ─────────────────────────────────────
  if (pathname === "/") {
    const redirect =
      role === "SUPER_ADMIN" || role === "OPS_VIEWER"
        ? "/ops/dashboard"
        : "/dashboard";
    return NextResponse.redirect(new URL(redirect, nextUrl));
  }

  // ─── Ops portal access control ─────────────────────────
  // Only SUPER_ADMIN and OPS_VIEWER can access /ops/*
  if (pathname.startsWith("/ops")) {
    if (role !== "SUPER_ADMIN" && role !== "OPS_VIEWER") {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }
    return NextResponse.next();
  }

  // ─── School portal access control ──────────────────────
  // School routes: /dashboard, /cameras, /alerts, /management, /users
  const schoolPaths = [
    "/dashboard",
    "/cameras",
    "/alerts",
    "/management",
    "/users",
  ];
  const isSchoolPath = schoolPaths.some((p) => pathname.startsWith(p));

  if (isSchoolPath) {
    // SUPER_ADMIN can access school portal (they can switch schools)
    if (role === "SUPER_ADMIN") {
      return NextResponse.next();
    }

    // OPS_VIEWER should not access school portal directly
    if (role === "OPS_VIEWER") {
      return NextResponse.redirect(new URL("/ops/dashboard", nextUrl));
    }

    // SCHOOL_ADMIN and SCHOOL_VIEWER must have a schoolId
    if (!schoolId) {
      return NextResponse.redirect(
        new URL("/login?error=no_school", nextUrl)
      );
    }

    // /users page is SCHOOL_ADMIN only
    if (pathname.startsWith("/users") && role !== "SCHOOL_ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }

    return NextResponse.next();
  }

  // ─── API route protection ──────────────────────────────
  if (pathname.startsWith("/api/")) {
    // API routes handle their own detailed auth in the route handlers
    // Middleware just ensures user is logged in (already checked above)
    return NextResponse.next();
  }

  // ─── Default: allow ────────────────────────────────────
  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

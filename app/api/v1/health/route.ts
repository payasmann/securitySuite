// ─── /api/v1/health ─────────────────────────────────────────────────────────
// Versioned agent health/heartbeat endpoint.
// Re-exports the handler from the original route for backward compatibility.
// Future breaking changes will be made here without affecting /api/health.
// ────────────────────────────────────────────────────────────────────────────

export { POST } from "@/app/api/health/route";

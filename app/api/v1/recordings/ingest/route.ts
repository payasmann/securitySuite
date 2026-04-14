// ─── /api/v1/recordings/ingest ──────────────────────────────────────────────
// Versioned recording ingest endpoint.
// Re-exports the handler from the original route for backward compatibility.
// Future breaking changes will be made here without affecting the legacy route.
// ────────────────────────────────────────────────────────────────────────────

export { POST } from "@/app/api/recordings/ingest/route";

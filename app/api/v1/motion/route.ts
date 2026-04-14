// ─── /api/v1/motion ─────────────────────────────────────────────────────────
// Versioned agent motion event endpoint.
// Re-exports the handler from the original route for backward compatibility.
// Future breaking changes will be made here without affecting /api/motion.
// ────────────────────────────────────────────────────────────────────────────

export { POST } from "@/app/api/motion/route";

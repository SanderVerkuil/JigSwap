// Re-export the generated persistence id/doc types from the gateway so the UI
// imports them here rather than from Convex's _generated/dataModel directly.
export type { Doc, Id } from "@jigswap/backend/convex/_generated/dataModel";

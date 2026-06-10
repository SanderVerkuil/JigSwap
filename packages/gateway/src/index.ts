// The framework-agnostic application gateway: the single chokepoint onto the Convex generated
// API, shared by every web tier (Next today, TanStack Start next) so the transport can be swapped
// without touching UI. UIs import `gateway` (and the persistence id/doc types) from here, never
// from `_generated/*` directly.
export { gateway } from "./operations";
export type { Doc, Id } from "./types";

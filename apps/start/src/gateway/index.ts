// The gateway now lives in the framework-agnostic @jigswap/gateway library so the TanStack Start
// tier can share it; this shim keeps the existing `@/gateway` import path stable for the Next UI.
export { gateway } from "@jigswap/gateway";
export type { Doc, Id } from "@jigswap/gateway";

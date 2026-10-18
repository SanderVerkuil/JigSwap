// Cross-context types are declared in each context that references them; source each from its
// owning (or canonical re-export) context to resolve the flat-barrel `export *` ambiguity.
// Branded ids: CopyId→Library, PuzzleDefinitionId→Catalog, ExchangeId→Exchange, FileId→Library,
// MemberId→Identity (its canonical owner; other contexts only carry the branded ref). StarRating is
// a shared 1–5 value object declared independently by Solving and Reputation; expose Solving's
// canonically (the boundary passes primitives, so the two structurally identical classes never
// cross). VisibilityPolicy is the Library outbound port the backend depends on; Sharing's circle-
// aware policy of the same name stays intra-context (relative imports) until it implements the port.
// TODO: hoist StarRating to the shared kernel; reconcile Sharing's policy with the Library port.
export type { PuzzleDefinitionId } from "./catalog";
export type { ExchangeId } from "./exchange";
export type { MemberId } from "./identity";
export type { CopyId, FileId, VisibilityPolicy } from "./library";
export type { StarRating } from "./solving";
// CircleId→Sharing (its owner; Conversation carries it as a circle thread's subject).
export type { CircleId } from "./sharing";

export * from "./catalog";
export * from "./conversation";
export * from "./exchange";
export * from "./household";
export * from "./identity";
export * from "./insights";
export * from "./library";
export * from "./notifications";
export * from "./onboarding";
export * from "./reputation";
export * from "./shared-kernel";
export * from "./sharing";
export * from "./social";
export * from "./solving";
export * from "./whats-new";

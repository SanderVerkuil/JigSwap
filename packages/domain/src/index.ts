// Cross-context types are declared in each context that references them; source each from its
// owning (or canonical re-export) context to resolve the flat-barrel `export *` ambiguity.
// Branded ids: CopyId→Library, PuzzleDefinitionId→Catalog, MemberId/ExchangeId→Exchange,
// FileId→Library. StarRating is a shared 1–5 value object declared independently by Solving and
// Reputation; expose Solving's canonically (the boundary passes primitives, so the two structurally
// identical classes never cross). TODO: hoist StarRating to the shared kernel.
export type { CopyId } from "./library";
export type { PuzzleDefinitionId } from "./catalog";
export type { ExchangeId, MemberId } from "./exchange";
export type { FileId } from "./library";
export type { StarRating } from "./solving";

export * from "./catalog";
export * from "./exchange";
export * from "./library";
export * from "./notifications";
export * from "./reputation";
export * from "./shared-kernel";
export * from "./solving";

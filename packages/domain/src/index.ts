// Cross-context branded ids are declared in each context that references them; source each from
// its OWNING context to resolve the barrel ambiguity (CopyId→Library, PuzzleDefinitionId→Catalog).
export type { CopyId } from "./library";
export type { PuzzleDefinitionId } from "./catalog";
// MemberId (a foreign Identity ref) is declared in both Exchange and Solving; FileId in both
// Library and Solving. Both are structurally identical branded ids — re-export one explicitly to
// resolve the `export *` ambiguity (mirrors the CopyId/PuzzleDefinitionId disambiguation above).
export type { MemberId } from "./exchange";
export type { FileId } from "./library";

export * from "./catalog";
export * from "./exchange";
export * from "./library";
export * from "./shared-kernel";
export * from "./solving";

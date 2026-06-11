import { Id } from "../../shared-kernel";

// The Catalog aggregates' own identities.
export type PuzzleDefinitionId = Id<"PuzzleDefinitionId">;
export type CatalogCategoryId = Id<"CatalogCategoryId">;

// A foreign-aggregate reference held as a branded string. Catalog records who submitted a
// definition but never loads that aggregate; the Member identity is owned by Identity & Access.
export type SubmitterId = Id<"SubmitterId">;

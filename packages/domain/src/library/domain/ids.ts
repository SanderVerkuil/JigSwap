import { Id } from "../../shared-kernel";

// The Library aggregates' own identities.
export type CopyId = Id<"CopyId">;
export type CollectionId = Id<"CollectionId">;
export type PersonalCategoryId = Id<"PersonalCategoryId">;
export type LoanId = Id<"LoanId">;

// Foreign-aggregate references held as branded strings. The Library context never loads
// these aggregates; it only carries their ids. OwnerId is a Member, owned by Identity &
// Access; PuzzleDefinitionId is owned by Catalog. Defining PuzzleDefinitionId LOCALLY (not
// importing from the Catalog context) keeps the contexts decoupled — the cross-context link
// is by id plus a cached snapshot (see catalog-snapshot.ts).
export type OwnerId = Id<"OwnerId">;
export type PuzzleDefinitionId = Id<"PuzzleDefinitionId">;

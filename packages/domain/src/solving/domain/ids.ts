import { Id } from "../../shared-kernel";

// The Solving aggregates' own identities.
export type CompletionId = Id<"CompletionId">;
export type GoalId = Id<"GoalId">;
export type PuzzleReviewId = Id<"PuzzleReviewId">;

// Foreign-aggregate references held as branded strings. The Solving context never loads these
// aggregates; it only carries their ids. MemberId is the solving member (owned by Identity &
// Access — the persisted `completions.userId`); PuzzleDefinitionId is owned by Catalog; CopyId
// is owned by Library. Defining them LOCALLY (not importing from the owning contexts) keeps the
// contexts decoupled — the cross-context link is by id only. These brands mirror the owning
// contexts' brands structurally; the barrel disambiguation is handled at integration.
export type MemberId = Id<"MemberId">;
export type PuzzleDefinitionId = Id<"PuzzleDefinitionId">;
export type CopyId = Id<"CopyId">;

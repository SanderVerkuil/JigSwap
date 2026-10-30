import { Result } from "../../../../shared-kernel";
import { MemberId, PuzzleDefinitionId, SolvingError } from "../../../domain";

// The facts about the reviewed definition, as the composition root found them. A member may
// review an approved definition, or one they submitted themselves (still pending, say, when they
// log a solve of it); anything else is PuzzleNotReviewable.
export interface ReviewedDefinition {
  readonly isApproved: boolean;
  readonly submitterId: MemberId;
}

// Create or replace the member's single review of a puzzle (one per member+puzzle; the
// persistence adapter enforces the cardinality). `rating` is validated 1–5. `puzzleId` holds a
// Convex `puzzles` doc id (the table column is `puzzleId`), carried under the
// PuzzleDefinitionId brand. `definition` is null when no definition has that id.
export interface UpsertPuzzleReviewCommand {
  readonly actingMemberId: MemberId;
  readonly puzzleId: PuzzleDefinitionId;
  readonly definition: ReviewedDefinition | null;
  readonly rating: number;
  readonly text?: string;
}

export interface UpsertPuzzleReview {
  (cmd: UpsertPuzzleReviewCommand): Promise<Result<void, SolvingError>>;
}

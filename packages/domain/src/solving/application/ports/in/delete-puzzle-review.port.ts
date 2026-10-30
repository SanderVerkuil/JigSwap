import { Result } from "../../../../shared-kernel";
import { MemberId, PuzzleDefinitionId } from "../../../domain";
import { SolvingApplicationError } from "../../errors";

// Delete the acting member's own review of a puzzle (stars and text). A member holds at most one
// review per puzzle, so the pair identifies it and nobody can name another member's review.
// `puzzleId` holds a Convex `puzzles` doc id, carried under the PuzzleDefinitionId brand.
export interface DeletePuzzleReviewCommand {
  readonly actingMemberId: MemberId;
  readonly puzzleId: PuzzleDefinitionId;
}

export interface DeletePuzzleReview {
  (
    cmd: DeletePuzzleReviewCommand,
  ): Promise<Result<void, SolvingApplicationError>>;
}

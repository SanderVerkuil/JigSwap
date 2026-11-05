import { err, ok } from "../../../shared-kernel";
import { SolvingApplicationError } from "../errors";
import {
  DeletePuzzleReview,
  DeletePuzzleReviewCommand,
} from "../ports/in/delete-puzzle-review.port";
import { PuzzleReviewRepository } from "../ports/out/review.repositories";

export interface DeletePuzzleReviewDeps {
  readonly puzzleReviews: PuzzleReviewRepository;
}

// Transaction script: remove the acting member's single review of the puzzle outright (no
// tombstone — the text is the member's personal data). The community rating is computed from the
// remaining reviews on read, so nothing else changes and no event is published.
export const makeDeletePuzzleReview =
  (deps: DeletePuzzleReviewDeps): DeletePuzzleReview =>
  async (cmd: DeletePuzzleReviewCommand) => {
    const removed = await deps.puzzleReviews.remove(
      cmd.actingMemberId,
      cmd.puzzleId,
    );
    if (!removed) {
      return err(SolvingApplicationError.puzzleReviewNotFound(cmd.puzzleId));
    }
    return ok(undefined);
  };

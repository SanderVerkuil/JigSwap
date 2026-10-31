import { err, ok } from "../../../shared-kernel";
import { SolvingApplicationError } from "../errors";
import {
  DeleteCopyReview,
  DeleteCopyReviewCommand,
} from "../ports/in/delete-copy-review.port";
import { CopyReviewRepository } from "../ports/out/review.repositories";

export interface DeleteCopyReviewDeps {
  readonly copyReviews: CopyReviewRepository;
}

// Transaction script: remove the acting member's single star review of the copy outright (no
// tombstone). The copy page computes its average from the remaining reviews on read, so nothing
// else changes and no event is published.
export const makeDeleteCopyReview =
  (deps: DeleteCopyReviewDeps): DeleteCopyReview =>
  async (cmd: DeleteCopyReviewCommand) => {
    const removed = await deps.copyReviews.remove(
      cmd.actingMemberId,
      cmd.copyId,
    );
    if (!removed) {
      return err(SolvingApplicationError.copyReviewNotFound(cmd.copyId));
    }
    return ok(undefined);
  };

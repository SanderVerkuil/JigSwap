import { err, ok, Result } from "../../../shared-kernel";
import { ReputationError } from "../../domain";
import { ReputationApplicationError } from "../errors";
import {
  ClearPartnerReviewComment,
  ClearPartnerReviewCommentCommand,
} from "../ports/in/clear-partner-review-comment.port";
import { PartnerReviewRepository } from "../ports/out/partner-review.repository";

export interface ClearPartnerReviewCommentDeps {
  readonly reviews: PartnerReviewRepository;
}

// Transaction script: load the member's own review of the exchange, let the entity clear its
// comment (reviewer-only), save. The ReputationProfile is deliberately not a dependency: the
// ratings stay, so the reviewee's reputation does not change.
export const makeClearPartnerReviewComment =
  (deps: ClearPartnerReviewCommentDeps): ClearPartnerReviewComment =>
  async (
    cmd: ClearPartnerReviewCommentCommand,
  ): Promise<Result<void, ReputationError | ReputationApplicationError>> => {
    const review = await deps.reviews.findByExchangeAndReviewer(
      cmd.exchangeId,
      cmd.reviewerId,
    );
    if (!review) {
      return err(
        ReputationApplicationError.partnerReviewNotFound(cmd.exchangeId),
      );
    }
    const cleared = review.clearComment(cmd.reviewerId);
    if (cleared.isErr) return err(cleared.error);
    await deps.reviews.save(review);
    return ok(undefined);
  };

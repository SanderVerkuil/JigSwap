import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { CopyReviewUpserted, SolvingError, StarRating } from "../../domain";
import {
  UpsertCopyReview,
  UpsertCopyReviewCommand,
} from "../ports/in/upsert-copy-review.port";
import { CopyReviewRepository } from "../ports/out/review.repositories";

export interface UpsertCopyReviewDeps {
  readonly copyReviews: CopyReviewRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: check the reviewer may review the copy (owner or completion-holder — the
// facts arrive on the command; → NotAllowedToReviewCopy), validate the 1–5 rating, upsert the
// member's single star-only review of the copy, publish CopyReviewUpserted.
export const makeUpsertCopyReview =
  (deps: UpsertCopyReviewDeps): UpsertCopyReview =>
  async (cmd: UpsertCopyReviewCommand) => {
    const isOwner = cmd.actingMemberId === cmd.copyOwnerId;
    if (!isOwner && !cmd.hasCompletionOnCopy) {
      return err(SolvingError.notAllowedToReviewCopy());
    }

    const rating = StarRating.create(cmd.rating);
    if (rating.isErr) return err(rating.error);

    const now = deps.clock.now();
    await deps.copyReviews.upsert({
      userId: cmd.actingMemberId,
      copyId: cmd.copyId,
      rating: rating.value.value,
      now,
    });
    await deps.events.publish([
      new CopyReviewUpserted(
        cmd.actingMemberId,
        cmd.copyId,
        rating.value.value,
        now,
      ),
    ]);
    return ok(undefined);
  };

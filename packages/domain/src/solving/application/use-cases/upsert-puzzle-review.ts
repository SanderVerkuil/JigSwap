import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { PuzzleReview, PuzzleReviewUpserted, StarRating } from "../../domain";
import {
  UpsertPuzzleReview,
  UpsertPuzzleReviewCommand,
} from "../ports/in/upsert-puzzle-review.port";
import { PuzzleReviewRepository } from "../ports/out/review.repositories";

export interface UpsertPuzzleReviewDeps {
  readonly puzzleReviews: PuzzleReviewRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: validate the 1–5 rating, normalise the text (PuzzleReview value object),
// upsert the member's single review of the puzzle, publish PuzzleReviewUpserted.
export const makeUpsertPuzzleReview =
  (deps: UpsertPuzzleReviewDeps): UpsertPuzzleReview =>
  async (cmd: UpsertPuzzleReviewCommand) => {
    const rating = StarRating.create(cmd.rating);
    if (rating.isErr) return err(rating.error);

    const review = PuzzleReview.create(rating.value, cmd.text);
    const now = deps.clock.now();
    await deps.puzzleReviews.upsert({
      userId: cmd.actingMemberId,
      puzzleDefinitionId: cmd.puzzleDefinitionId,
      rating: review.rating.value,
      text: review.text,
      now,
    });
    await deps.events.publish([
      new PuzzleReviewUpserted(
        cmd.actingMemberId,
        cmd.puzzleDefinitionId,
        review.rating.value,
        now,
      ),
    ]);
    return ok(undefined);
  };

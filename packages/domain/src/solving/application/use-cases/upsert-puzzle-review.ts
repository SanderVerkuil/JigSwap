import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { PuzzleReviewUpserted, StarRating } from "../../domain";
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

// Normalise an empty/whitespace-only text to undefined so persistence never stores "".
const normalizeText = (text?: string): string | undefined => {
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

// Transaction script: validate the 1–5 rating, normalise the text, upsert the member's single
// review of the puzzle, publish PuzzleReviewUpserted.
export const makeUpsertPuzzleReview =
  (deps: UpsertPuzzleReviewDeps): UpsertPuzzleReview =>
  async (cmd: UpsertPuzzleReviewCommand) => {
    const rating = StarRating.create(cmd.rating);
    if (rating.isErr) return err(rating.error);

    const now = deps.clock.now();
    await deps.puzzleReviews.upsert({
      userId: cmd.actingMemberId,
      puzzleId: cmd.puzzleId,
      rating: rating.value.value,
      text: normalizeText(cmd.text),
      now,
    });
    await deps.events.publish([
      new PuzzleReviewUpserted(
        cmd.actingMemberId,
        cmd.puzzleId,
        rating.value.value,
        now,
      ),
    ]);
    return ok(undefined);
  };

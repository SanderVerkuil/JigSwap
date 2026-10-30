import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { PuzzleReviewUpserted, SolvingError, StarRating } from "../../domain";
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

// The longest review text a member may store, in UTF-16 code units (what a browser's maxLength
// counts), measured after trimming.
export const REVIEW_TEXT_MAX_LENGTH = 2000;

// Normalise an empty/whitespace-only text to undefined so persistence never stores "".
const normalizeText = (text?: string): string | undefined => {
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

// Transaction script: validate the 1–5 rating, normalise the text and refuse it past
// REVIEW_TEXT_MAX_LENGTH (ReviewTextTooLong), upsert the member's single review of the puzzle,
// publish PuzzleReviewUpserted. A stored review longer than the cap is not grandfathered: the
// form shows the stored text, so a member editing it shortens it in the same place.
export const makeUpsertPuzzleReview =
  (deps: UpsertPuzzleReviewDeps): UpsertPuzzleReview =>
  async (cmd: UpsertPuzzleReviewCommand) => {
    const rating = StarRating.create(cmd.rating);
    if (rating.isErr) return err(rating.error);

    const text = normalizeText(cmd.text);
    if (text !== undefined && text.length > REVIEW_TEXT_MAX_LENGTH) {
      return err(SolvingError.reviewTextTooLong(REVIEW_TEXT_MAX_LENGTH));
    }

    const now = deps.clock.now();
    await deps.puzzleReviews.upsert({
      userId: cmd.actingMemberId,
      puzzleId: cmd.puzzleId,
      rating: rating.value.value,
      text,
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

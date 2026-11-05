import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import {
  MemberId,
  PuzzleReviewUpserted,
  SolvingError,
  StarRating,
} from "../../domain";
import {
  ReviewedDefinition,
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

// Whether `memberId` may review the definition: it exists and is approved, or they submitted it.
// The rule makeUpsertPuzzleReview enforces; read sides use it to offer the review form only when a
// save can succeed.
export const mayReviewDefinition = (
  memberId: MemberId,
  definition: ReviewedDefinition | null,
): boolean =>
  definition !== null &&
  (definition.isApproved || definition.submitterId === memberId);

// Normalise an empty/whitespace-only text to undefined so persistence never stores "".
const normalizeText = (text?: string): string | undefined => {
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

// Transaction script: check the definition may be reviewed (it exists and is approved, or the
// reviewer submitted it; the facts arrive on the command → PuzzleNotReviewable), validate the 1–5
// rating, normalise the text and refuse it past REVIEW_TEXT_MAX_LENGTH (ReviewTextTooLong), upsert
// the member's single review of the puzzle, publish PuzzleReviewUpserted. A stored text from before
// the cap may be saved back unchanged, so a member can still change just the rating; any edit to it
// has to fit.
export const makeUpsertPuzzleReview =
  (deps: UpsertPuzzleReviewDeps): UpsertPuzzleReview =>
  async (cmd: UpsertPuzzleReviewCommand) => {
    if (!mayReviewDefinition(cmd.actingMemberId, cmd.definition)) {
      return err(SolvingError.puzzleNotReviewable());
    }

    const rating = StarRating.create(cmd.rating);
    if (rating.isErr) return err(rating.error);

    const text = normalizeText(cmd.text);
    if (
      text !== undefined &&
      text.length > REVIEW_TEXT_MAX_LENGTH &&
      text !==
        (await deps.puzzleReviews.storedText(cmd.actingMemberId, cmd.puzzleId))
    ) {
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

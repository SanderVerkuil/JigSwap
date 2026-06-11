import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { SolvingError, StarRating } from "../../domain";
import { SolvingApplicationError } from "../errors";
import {
  ReviewPuzzle,
  ReviewPuzzleCommand,
} from "../ports/in/review-puzzle.port";
import { CompletionRepository } from "../ports/out/completion.repository";

export interface ReviewPuzzleDeps {
  readonly completions: CompletionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CompletionNotFound), check ownership, validate the 1–5 rating,
// attach the PuzzleReview (→ PuzzleReviewed), persist, publish.
export const makeReviewPuzzle =
  (deps: ReviewPuzzleDeps): ReviewPuzzle =>
  async (cmd: ReviewPuzzleCommand) => {
    const completion = await deps.completions.findById(cmd.completionId);
    if (!completion) {
      return err(SolvingApplicationError.completionNotFound(cmd.completionId));
    }
    if (completion.userId !== cmd.actingMemberId) {
      return err(SolvingError.notCompletionOwner());
    }

    const rating = StarRating.create(cmd.rating);
    if (rating.isErr) return err(rating.error);

    const outcome = completion.review(rating.value, deps.clock.now(), cmd.text);
    if (outcome.isErr) return err(outcome.error);

    await deps.completions.save(completion);
    await deps.events.publish(completion.pullEvents());
    return ok(undefined);
  };

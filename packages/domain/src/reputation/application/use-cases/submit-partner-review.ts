import { Clock, DomainEvent, DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import {
  PartnerReview,
  PartnerReviewId,
  ReputationError,
  ReputationProfile,
} from "../../domain";
import { ReputationApplicationError } from "../errors";
import {
  SubmitPartnerReview,
  SubmitPartnerReviewCommand,
} from "../ports/in/submit-partner-review.port";
import { ExchangeCompletionPort } from "../ports/out/exchange-completion.port";
import {
  PartnerReviewIdGenerator,
  ReputationProfileIdGenerator,
} from "../ports/out/id-generators";
import { PartnerReviewRepository } from "../ports/out/partner-review.repository";
import { ReputationProfileRepository } from "../ports/out/reputation-profile.repository";

export interface SubmitPartnerReviewDeps {
  readonly reviews: PartnerReviewRepository;
  readonly profiles: ReputationProfileRepository;
  readonly exchanges: ExchangeCompletionPort;
  readonly reviewIds: PartnerReviewIdGenerator;
  readonly profileIds: ReputationProfileIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: gate on the Exchange seam (the exchange completed and the two parties
// match), enforce the one-review-per-reviewer-per-exchange uniqueness, then delegate the
// entity rules (self-review, rating validity) to PartnerReview.submit. On success the
// reviewee's ReputationProfile is loaded (or opened) and recomputed, and every recorded event
// from both aggregates is published together.
export const makeSubmitPartnerReview =
  (deps: SubmitPartnerReviewDeps): SubmitPartnerReview =>
  async (
    cmd: SubmitPartnerReviewCommand,
  ): Promise<Result<PartnerReviewId, ReputationError | ReputationApplicationError>> => {
    // Seam to Exchange: only a completed exchange between exactly these two parties opens a
    // review window. The port collapses not-completed and party-mismatch into one predicate;
    // a false result here means no window is open.
    const completed = await deps.exchanges.isCompletedBetween(
      cmd.exchangeId,
      cmd.reviewerId,
      cmd.revieweeId,
    );
    if (!completed) {
      return err(ReputationApplicationError.exchangeNotCompleted(cmd.exchangeId));
    }

    // One review per reviewer per exchange.
    const existing = await deps.reviews.findByExchangeAndReviewer(
      cmd.exchangeId,
      cmd.reviewerId,
    );
    if (existing) {
      return err(ReputationApplicationError.duplicatePartnerReview(cmd.exchangeId));
    }

    // Entity rules: self-review and rating bounds (overall + per-category).
    const review = PartnerReview.submit({
      id: deps.reviewIds.next(),
      exchangeId: cmd.exchangeId,
      reviewerId: cmd.reviewerId,
      revieweeId: cmd.revieweeId,
      rating: cmd.rating,
      comment: cmd.comment,
      scores: cmd.scores,
      now: deps.clock.now(),
    });
    if (review.isErr) return err(review.error);

    await deps.reviews.save(review.value);

    // Fold the review into the reviewee's profile, opening a fresh one if none exists.
    const existingProfile = await deps.profiles.findByMember(cmd.revieweeId);
    const profile =
      existingProfile ??
      ReputationProfile.open(deps.profileIds.next(), cmd.revieweeId, deps.clock.now());
    profile.applyReview(review.value, deps.clock.now());
    await deps.profiles.save(profile);

    // Publish both aggregates' events together: PartnerReviewSubmitted then ReputationChanged.
    const events: DomainEvent[] = [...review.value.pullEvents(), ...profile.pullEvents()];
    await deps.events.publish(events);

    return ok(review.value.id);
  };

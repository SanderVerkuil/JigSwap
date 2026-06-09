import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { ReputationError } from "./errors";
import { PartnerReviewSubmitted } from "./events";
import { ExchangeId, MemberId, PartnerReviewId } from "./ids";
import { PartnerReviewScores, PartnerReviewScoresInput } from "./review-scores";
import { StarRating } from "./star-rating";

// Input to submit(): the still-unvalidated overall rating and category sub-scores plus the
// parties and the exchange the review pertains to. Cross-aggregate checks (the exchange is
// completed, the parties match, one-review-per-party) are application-layer concerns; the
// aggregate decides only from its own data.
export interface SubmitProps {
  readonly id: PartnerReviewId;
  readonly exchangeId: ExchangeId;
  readonly reviewerId: MemberId;
  readonly revieweeId: MemberId;
  readonly rating: number;
  readonly comment?: string;
  readonly scores: PartnerReviewScoresInput;
  readonly now: Date;
}

// The persistable shape, kept deliberately close to the `reviews` table columns so the 1b
// mapper is a trivial field-for-field translation (StarRating <-> number).
export interface PartnerReviewState {
  readonly id: PartnerReviewId;
  readonly exchangeId: ExchangeId;
  readonly reviewerId: MemberId;
  readonly revieweeId: MemberId;
  readonly rating: StarRating;
  readonly comment?: string;
  readonly scores: PartnerReviewScores;
  readonly createdAt: Date;
}

// PartnerReview: trust feedback ABOUT A PERSON (named to kill the homonym with Solving's
// PuzzleReview, which is an opinion about a puzzle). An entity within the Reputation context;
// the ReputationProfile is the aggregate that consumes it.
export class PartnerReview {
  private events: DomainEvent[] = [];

  private constructor(private readonly state: PartnerReviewState) {}

  get id(): PartnerReviewId {
    return this.state.id;
  }

  get reviewerId(): MemberId {
    return this.state.reviewerId;
  }

  get revieweeId(): MemberId {
    return this.state.revieweeId;
  }

  get exchangeId(): ExchangeId {
    return this.state.exchangeId;
  }

  get rating(): StarRating {
    return this.state.rating;
  }

  // Create a brand-new partner review. Decides only from its own data: rejects self-review
  // and any invalid rating (overall or per-category). Window/uniqueness/exchange-completed
  // checks need ports and live in the application layer (1b), not here.
  static submit(props: SubmitProps): Result<PartnerReview, ReputationError> {
    if (props.reviewerId === props.revieweeId) {
      return err(ReputationError.selfReview());
    }

    const rating = StarRating.create(props.rating);
    if (rating.isErr) return err(rating.error);

    const scores = PartnerReviewScores.create(props.scores);
    if (scores.isErr) return err(scores.error);

    const review = new PartnerReview({
      id: props.id,
      exchangeId: props.exchangeId,
      reviewerId: props.reviewerId,
      revieweeId: props.revieweeId,
      rating: rating.value,
      comment: props.comment,
      scores: scores.value,
      createdAt: props.now,
    });
    review.record(
      new PartnerReviewSubmitted(
        review.id,
        props.exchangeId,
        props.reviewerId,
        props.revieweeId,
        rating.value.value,
        props.now,
      ),
    );
    return ok(review);
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the entity knowing about any storage technology.
  static rehydrate(state: PartnerReviewState): PartnerReview {
    return new PartnerReview(state);
  }

  toState(): PartnerReviewState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}

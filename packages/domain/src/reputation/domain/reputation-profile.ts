import { DomainEvent } from "../../shared-kernel";
import { ReputationChanged } from "./events";
import { MemberId, ReputationProfileId } from "./ids";
import { PartnerReview } from "./partner-review";

// The persistable shape of a member's aggregated reputation. We keep the running `ratingSum`
// and `reviewCount` (rather than only the average) so applyReview recomputes exactly without
// reloading every PartnerReview, and so the stored average is always derivable. `credibility`
// is a 0-1 confidence that grows with the number of reviews (a simple, deterministic curve).
export interface ReputationProfileState {
  readonly id: ReputationProfileId;
  readonly memberId: MemberId;
  readonly ratingSum: number;
  readonly reviewCount: number;
  readonly averageRating: number;
  readonly credibility: number;
  readonly updatedAt: Date;
}

// Number of reviews at which credibility is considered fully established.
const CREDIBILITY_SATURATION = 10;

// ReputationProfile: the per-member aggregate root. It consumes PartnerReviews (received as
// the reviewee) and maintains the aggregate score + count + credibility. Recomputing on each
// applied review keeps the average authoritative and emits ReputationChanged.
export class ReputationProfile {
  private events: DomainEvent[] = [];

  private constructor(private state: ReputationProfileState) {}

  get id(): ReputationProfileId {
    return this.state.id;
  }

  get memberId(): MemberId {
    return this.state.memberId;
  }

  get averageRating(): number {
    return this.state.averageRating;
  }

  get reviewCount(): number {
    return this.state.reviewCount;
  }

  get credibility(): number {
    return this.state.credibility;
  }

  // A fresh, empty profile for a member who has not yet been reviewed.
  static open(id: ReputationProfileId, memberId: MemberId, now: Date): ReputationProfile {
    return new ReputationProfile({
      id,
      memberId,
      ratingSum: 0,
      reviewCount: 0,
      averageRating: 0,
      credibility: 0,
      updatedAt: now,
    });
  }

  // Fold a received review into the aggregate: add its overall rating to the running sum,
  // bump the count, recompute the average and credibility, then emit ReputationChanged. The
  // review must be ABOUT this member (revieweeId === memberId); the application layer loads
  // the reviewee's profile, so this is an invariant the caller upholds.
  applyReview(review: PartnerReview, now: Date): void {
    const ratingSum = this.state.ratingSum + review.rating.value;
    const reviewCount = this.state.reviewCount + 1;
    const averageRating = ratingSum / reviewCount;
    const credibility = Math.min(reviewCount / CREDIBILITY_SATURATION, 1);

    this.state = {
      ...this.state,
      ratingSum,
      reviewCount,
      averageRating,
      credibility,
      updatedAt: now,
    };

    this.record(new ReputationChanged(this.state.memberId, averageRating, reviewCount, now));
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: ReputationProfileState): ReputationProfile {
    return new ReputationProfile(state);
  }

  toState(): ReputationProfileState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}

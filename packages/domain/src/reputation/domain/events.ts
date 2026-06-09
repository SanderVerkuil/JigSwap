import { DomainEvent } from "../../shared-kernel";
import { ExchangeId, MemberId, PartnerReviewId } from "./ids";

// All Reputation domain events implement DomainEvent (name + occurredAt). They are plain
// immutable records: the aggregate records them; an outbound publisher (1b) serialises and
// dispatches them to subscribers (Notifications, Insights, and the member's own profile).

// A trust review about a person was submitted following a completed exchange.
export class PartnerReviewSubmitted implements DomainEvent {
  readonly name = "PartnerReviewSubmitted";
  constructor(
    readonly reviewId: PartnerReviewId,
    readonly exchangeId: ExchangeId,
    readonly reviewerId: MemberId,
    readonly revieweeId: MemberId,
    readonly rating: number,
    readonly occurredAt: Date,
  ) {}
}

// A member's aggregated reputation changed because a new review was applied. Carries the
// recomputed average and review count so subscribers need not reload the profile.
export class ReputationChanged implements DomainEvent {
  readonly name = "ReputationChanged";
  constructor(
    readonly memberId: MemberId,
    readonly averageRating: number,
    readonly reviewCount: number,
    readonly occurredAt: Date,
  ) {}
}

export type ReputationDomainEvent = PartnerReviewSubmitted | ReputationChanged;

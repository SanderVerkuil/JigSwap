import { ExchangeId, MemberId } from "../../../domain";

// The Reputation context's read-only seam (anti-corruption boundary) to Exchange. A partner
// review is only allowed AFTER the exchange COMPLETED and the reviewer/reviewee were its two
// parties. Reputation depends on this narrow predicate, not on Exchange's tables or aggregate.
// The real adapter reads the `exchanges` table in Phase 3c.
export interface ExchangeCompletionPort {
  // True iff the given exchange is completed and {reviewerId, revieweeId} are exactly its two
  // parties (order-independent). False for any other state or party mismatch.
  isCompletedBetween(
    exchangeId: ExchangeId,
    reviewerId: MemberId,
    revieweeId: MemberId,
  ): Promise<boolean>;
}

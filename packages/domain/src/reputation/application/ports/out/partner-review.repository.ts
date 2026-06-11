import { ExchangeId, MemberId, PartnerReview } from "../../../domain";

// Outbound port: persistence for PartnerReviews. The 1b-convex adapter implements this over
// `ctx.db` (the `reviews` table) behind a mapper; the domain never sees a row.
export interface PartnerReviewRepository {
  // Backs the uniqueness rule: at most one review per reviewer per exchange. Returns the
  // existing review if this reviewer already reviewed this exchange, else null.
  findByExchangeAndReviewer(
    exchangeId: ExchangeId,
    reviewerId: MemberId,
  ): Promise<PartnerReview | null>;
  save(review: PartnerReview): Promise<void>;
  // All reviews received by a member (as reviewee); supports profile rebuilds and reads.
  listForReviewee(revieweeId: MemberId): Promise<readonly PartnerReview[]>;
}

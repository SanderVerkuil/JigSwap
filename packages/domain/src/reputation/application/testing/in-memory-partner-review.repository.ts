import {
  ExchangeId,
  MemberId,
  PartnerReview,
  PartnerReviewId,
} from "../../domain";
import { PartnerReviewRepository } from "../ports/out/partner-review.repository";

// In-memory PartnerReviewRepository for use-case tests. Stores persisted state and rehydrates
// a fresh entity on read, mirroring the round-trip a real adapter performs.
export class InMemoryPartnerReviewRepository implements PartnerReviewRepository {
  private readonly store = new Map<
    PartnerReviewId,
    ReturnType<PartnerReview["toState"]>
  >();

  async findByExchangeAndReviewer(
    exchangeId: ExchangeId,
    reviewerId: MemberId,
  ): Promise<PartnerReview | null> {
    for (const state of this.store.values()) {
      if (state.exchangeId === exchangeId && state.reviewerId === reviewerId) {
        return PartnerReview.rehydrate(state);
      }
    }
    return null;
  }

  async save(review: PartnerReview): Promise<void> {
    this.store.set(review.id, review.toState());
  }

  async listForReviewee(
    revieweeId: MemberId,
  ): Promise<readonly PartnerReview[]> {
    const result: PartnerReview[] = [];
    for (const state of this.store.values()) {
      if (state.revieweeId === revieweeId) {
        result.push(PartnerReview.rehydrate(state));
      }
    }
    return result;
  }

  // Test helper: how many reviews are currently stored.
  size(): number {
    return this.store.size;
  }
}

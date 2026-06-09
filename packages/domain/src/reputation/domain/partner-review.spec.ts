import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { ExchangeId, MemberId, PartnerReviewId } from "./ids";
import { PartnerReview, SubmitProps } from "./partner-review";

const reviewer = toId<"MemberId">("alice") as MemberId;
const reviewee = toId<"MemberId">("bob") as MemberId;
const exchangeId = toId<"ExchangeId">("ex-1") as ExchangeId;
const reviewId = toId<"PartnerReviewId">("review-1") as PartnerReviewId;
const NOW = new Date("2026-06-08T10:00:00Z");

const props = (over: Partial<SubmitProps> = {}): SubmitProps => ({
  id: reviewId,
  exchangeId,
  reviewerId: reviewer,
  revieweeId: reviewee,
  rating: 4,
  comment: "Smooth trade",
  scores: { communication: 5, packaging: 4, condition: 4, timeliness: 3 },
  now: NOW,
  ...over,
});

describe("PartnerReview.submit", () => {
  it("creates a review and records PartnerReviewSubmitted with the rating", () => {
    const result = PartnerReview.submit(props());
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    const review = result.value;
    expect(review.rating.value).toBe(4);
    const events = review.pullEvents();
    expect(events.map((e) => e.name)).toEqual(["PartnerReviewSubmitted"]);
    const submitted = events[0] as unknown as {
      reviewerId: MemberId;
      revieweeId: MemberId;
      rating: number;
    };
    expect(submitted.reviewerId).toBe(reviewer);
    expect(submitted.revieweeId).toBe(reviewee);
    expect(submitted.rating).toBe(4);
  });

  it("drains events only once", () => {
    const result = PartnerReview.submit(props());
    if (!result.isOk) throw new Error("setup");
    expect(result.value.pullEvents()).toHaveLength(1);
    expect(result.value.pullEvents()).toHaveLength(0);
  });

  it("rejects a self-review (reviewer === reviewee)", () => {
    const result = PartnerReview.submit(props({ revieweeId: reviewer }));
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("SelfReview");
  });

  it.each([0, 6])("rejects an out-of-bounds overall rating %s", (rating) => {
    const result = PartnerReview.submit(props({ rating }));
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidRating");
  });

  it("rejects an out-of-bounds category sub-score", () => {
    const result = PartnerReview.submit(
      props({ scores: { communication: 0, packaging: 4, condition: 4, timeliness: 3 } }),
    );
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("InvalidRating");
  });

  it("round-trips through toState/rehydrate", () => {
    const result = PartnerReview.submit(props());
    if (!result.isOk) throw new Error("setup");
    const state = result.value.toState();
    expect(state.comment).toBe("Smooth trade");
    const rehydrated = PartnerReview.rehydrate(state);
    expect(rehydrated.id).toBe(reviewId);
    expect(rehydrated.rating.value).toBe(4);
    // Rehydration does not re-emit creation events.
    expect(rehydrated.pullEvents()).toHaveLength(0);
  });
});

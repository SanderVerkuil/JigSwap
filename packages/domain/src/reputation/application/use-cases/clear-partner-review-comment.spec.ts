import { beforeEach, describe, expect, it } from "vitest";
import {
  toExchangeId,
  toMemberId,
  toPartnerReviewId,
  toReputationProfileId,
} from "../../../shared-kernel";
import { PartnerReview, ReputationProfile } from "../../domain";
import {
  InMemoryPartnerReviewRepository,
  InMemoryReputationProfileRepository,
} from "../testing";
import { makeClearPartnerReviewComment } from "./clear-partner-review-comment";

const alice = toMemberId("alice"); // reviewer
const bob = toMemberId("bob"); // reviewee
const exchangeId = toExchangeId("ex-1");
const NOW = new Date("2026-10-30T10:00:00Z");

describe("makeClearPartnerReviewComment", () => {
  let reviews: InMemoryPartnerReviewRepository;
  let profiles: InMemoryReputationProfileRepository;
  let clear: ReturnType<typeof makeClearPartnerReviewComment>;

  beforeEach(async () => {
    reviews = new InMemoryPartnerReviewRepository();
    profiles = new InMemoryReputationProfileRepository();
    const review = PartnerReview.submit({
      id: toPartnerReviewId("review-1"),
      exchangeId,
      reviewerId: alice,
      revieweeId: bob,
      rating: 2,
      comment: "Arrived late, box crushed",
      scores: { communication: 3, packaging: 1, condition: 2, timeliness: 1 },
      now: NOW,
    });
    if (!review.isOk) throw new Error("setup");
    await reviews.save(review.value);
    const profile = ReputationProfile.open(
      toReputationProfileId("profile-1"),
      bob,
      NOW,
    );
    profile.applyReview(review.value, NOW);
    await profiles.save(profile);
    clear = makeClearPartnerReviewComment({ reviews });
  });

  it("removes the reviewer's comment and leaves the ratings and the reviewee's reputation alone", async () => {
    const profileBefore = (await profiles.findByMember(bob))?.toState();

    const result = await clear({ exchangeId, reviewerId: alice });

    expect(result.isOk).toBe(true);
    const stored = await reviews.findByExchangeAndReviewer(exchangeId, alice);
    expect(stored?.comment).toBeUndefined();
    expect(stored?.rating.value).toBe(2);
    expect(stored?.toState().scores.packaging.value).toBe(1);
    expect((await profiles.findByMember(bob))?.toState()).toEqual(
      profileBefore,
    );
  });

  it("answers PartnerReviewNotFound when the member did not review this exchange", async () => {
    const result = await clear({ exchangeId, reviewerId: bob });

    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("PartnerReviewNotFound");
    const stored = await reviews.findByExchangeAndReviewer(exchangeId, alice);
    expect(stored?.comment).toBe("Arrived late, box crushed");
  });
});

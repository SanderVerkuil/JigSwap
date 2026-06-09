import { describe, expect, it } from "vitest";
import { toId } from "../../shared-kernel";
import { ExchangeId, MemberId, PartnerReviewId, ReputationProfileId } from "./ids";
import { PartnerReview } from "./partner-review";
import { ReputationProfile } from "./reputation-profile";

const member = toId<"MemberId">("bob") as MemberId;
const profileId = toId<"ReputationProfileId">("profile-1") as ReputationProfileId;
const NOW = new Date("2026-06-08T10:00:00Z");

let reviewSeq = 0;
const reviewWithRating = (rating: number): PartnerReview => {
  reviewSeq += 1;
  const result = PartnerReview.submit({
    id: toId<"PartnerReviewId">(`review-${reviewSeq}`) as PartnerReviewId,
    exchangeId: toId<"ExchangeId">(`ex-${reviewSeq}`) as ExchangeId,
    reviewerId: toId<"MemberId">(`reviewer-${reviewSeq}`) as MemberId,
    revieweeId: member,
    rating,
    scores: { communication: rating, packaging: rating, condition: rating, timeliness: rating },
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup");
  result.value.pullEvents(); // discard the review's own event
  return result.value;
};

describe("ReputationProfile", () => {
  it("opens empty with a zero average, count, and credibility", () => {
    const profile = ReputationProfile.open(profileId, member, NOW);
    expect(profile.reviewCount).toBe(0);
    expect(profile.averageRating).toBe(0);
    expect(profile.credibility).toBe(0);
    expect(profile.pullEvents()).toHaveLength(0);
  });

  it("recomputes the average across multiple applied reviews", () => {
    const profile = ReputationProfile.open(profileId, member, NOW);

    profile.applyReview(reviewWithRating(5), NOW);
    expect(profile.reviewCount).toBe(1);
    expect(profile.averageRating).toBe(5);

    profile.applyReview(reviewWithRating(3), NOW);
    expect(profile.reviewCount).toBe(2);
    expect(profile.averageRating).toBe(4); // (5 + 3) / 2

    profile.applyReview(reviewWithRating(1), NOW);
    expect(profile.reviewCount).toBe(3);
    expect(profile.averageRating).toBeCloseTo(3, 10); // (5 + 3 + 1) / 3
  });

  it("emits ReputationChanged carrying the recomputed average and count on each apply", () => {
    const profile = ReputationProfile.open(profileId, member, NOW);
    profile.applyReview(reviewWithRating(4), NOW);
    profile.applyReview(reviewWithRating(2), NOW);

    const events = profile.pullEvents() as unknown as Array<{
      name: string;
      averageRating: number;
      reviewCount: number;
      memberId: MemberId;
    }>;
    expect(events.map((e) => e.name)).toEqual(["ReputationChanged", "ReputationChanged"]);
    expect(events[0].averageRating).toBe(4);
    expect(events[0].reviewCount).toBe(1);
    expect(events[1].averageRating).toBe(3); // (4 + 2) / 2
    expect(events[1].reviewCount).toBe(2);
    expect(events[1].memberId).toBe(member);
  });

  it("grows credibility with review count and caps it at 1", () => {
    const profile = ReputationProfile.open(profileId, member, NOW);
    profile.applyReview(reviewWithRating(5), NOW);
    expect(profile.credibility).toBeCloseTo(0.1, 10); // 1 / 10

    for (let i = 0; i < 20; i += 1) profile.applyReview(reviewWithRating(5), NOW);
    expect(profile.credibility).toBe(1);
  });

  it("round-trips through toState/rehydrate", () => {
    const profile = ReputationProfile.open(profileId, member, NOW);
    profile.applyReview(reviewWithRating(5), NOW);
    const rehydrated = ReputationProfile.rehydrate(profile.toState());
    expect(rehydrated.averageRating).toBe(5);
    expect(rehydrated.reviewCount).toBe(1);
    expect(rehydrated.memberId).toBe(member);
  });
});

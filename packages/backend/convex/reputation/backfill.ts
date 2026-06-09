import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

// Number of reviews at which credibility is considered fully established — mirrors the domain's
// ReputationProfile.CREDIBILITY_SATURATION so the rebuilt projection matches live writes exactly.
const CREDIBILITY_SATURATION = 10;

// One-shot, idempotent migration so the new Reputation functions (which look up by aggregateId)
// can act on legacy rows, AND so the reputationProfiles projection is consistent with historical
// data. Two passes:
//   1. Stamp aggregateId on every `reviews` row missing one.
//   2. REBUILD reputationProfiles from scratch by aggregating ALL reviews per reviewee. The
//      profile is a pure fold of received reviews, so a full rebuild is deterministic and
//      re-runnable: each run recomputes the same sums/averages/credibility and patches (or
//      inserts) the per-member row.
export const backfillReputation = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const reviews = await ctx.db.query("reviews").collect();

    let reviewsStamped = 0;
    for (const review of reviews) {
      if (review.aggregateId) continue;
      await ctx.db.patch(review._id, { aggregateId: crypto.randomUUID() });
      reviewsStamped++;
    }

    // Aggregate every review by its reviewee (the member it is ABOUT).
    const byMember = new Map<
      string,
      { memberId: Id<"users">; ratingSum: number; reviewCount: number }
    >();
    for (const review of reviews) {
      const key = review.revieweeId as unknown as string;
      const acc =
        byMember.get(key) ??
        { memberId: review.revieweeId, ratingSum: 0, reviewCount: 0 };
      acc.ratingSum += review.rating;
      acc.reviewCount += 1;
      byMember.set(key, acc);
    }

    let profilesUpserted = 0;
    for (const { memberId, ratingSum, reviewCount } of byMember.values()) {
      const averageRating = reviewCount === 0 ? 0 : ratingSum / reviewCount;
      const credibility = Math.min(reviewCount / CREDIBILITY_SATURATION, 1);
      const existing = await ctx.db
        .query("reputationProfiles")
        .withIndex("by_member", (q) => q.eq("memberId", memberId))
        .unique();
      const row = {
        memberId,
        ratingSum,
        reviewCount,
        averageRating,
        credibility,
        updatedAt: now,
      };
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("reputationProfiles", {
          ...row,
          aggregateId: crypto.randomUUID(),
        });
      }
      profilesUpserted++;
    }

    return { reviewsStamped, profilesUpserted };
  },
});

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

// Number of reviews at which credibility is considered fully established — mirrors the domain's
// ReputationProfile.CREDIBILITY_SATURATION so the rebuilt projection matches live writes exactly.
const CREDIBILITY_SATURATION = 10;

// One-shot, idempotent migration so the new Reputation functions (which look up by aggregateId)
// can act on legacy rows, AND so the reputationProfiles projection is consistent with historical
// data. Two phases, each paging its table in cursor batches (`batchSize` rows, default 100), one
// transaction each:
//   1. "stamp": stamp aggregateId on every `reviews` row missing one.
//   2. "rebuild": REBUILD reputationProfiles by folding, per member (`users`), ALL the reviews
//      they received (by_reviewee). The profile is a pure fold of received reviews, so a rebuild
//      is deterministic and re-runnable: each run recomputes the same sums/averages/credibility
//      and patches (or inserts) the per-member row. Members without reviews get no profile.
// Pass `continueCursor` back as `cursor` until `isDone` is true, per phase:
//   npx convex run reputation/backfill:backfillReputation '{"phase":"stamp"}'
//   npx convex run reputation/backfill:backfillReputation '{"phase":"rebuild"}'
//   (then '{"phase":"…","cursor":"<continueCursor>"}' while isDone is false)
export const backfillReputation = internalMutation({
  args: {
    phase: v.union(v.literal("stamp"), v.literal("rebuild")),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { phase, cursor, batchSize }) => {
    const paginationOpts = {
      cursor: cursor ?? null,
      numItems: batchSize ?? 100,
    };

    if (phase === "stamp") {
      const page = await ctx.db.query("reviews").paginate(paginationOpts);
      // Reviews stamped.
      let patched = 0;
      for (const review of page.page) {
        if (review.aggregateId) continue;
        await ctx.db.patch(review._id, { aggregateId: crypto.randomUUID() });
        patched++;
      }
      return {
        phase,
        scanned: page.page.length,
        patched,
        isDone: page.isDone,
        continueCursor: page.isDone ? null : page.continueCursor,
      };
    }

    const now = Date.now();
    const page = await ctx.db.query("users").paginate(paginationOpts);
    // Profiles upserted.
    let patched = 0;
    for (const member of page.page) {
      const received = await ctx.db
        .query("reviews")
        .withIndex("by_reviewee", (q) => q.eq("revieweeId", member._id))
        .collect();
      if (received.length === 0) continue;
      const ratingSum = received.reduce(
        (sum, review) => sum + review.rating,
        0,
      );
      const reviewCount = received.length;
      const averageRating = ratingSum / reviewCount;
      const credibility = Math.min(reviewCount / CREDIBILITY_SATURATION, 1);
      const existing = await ctx.db
        .query("reputationProfiles")
        .withIndex("by_member", (q) => q.eq("memberId", member._id))
        .unique();
      const row = {
        memberId: member._id,
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
      patched++;
    }
    return {
      phase,
      scanned: page.page.length,
      patched,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});

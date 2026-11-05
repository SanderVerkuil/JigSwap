import {
  computePersonalStats,
  isPlausibleSolveMinutes,
  type ExchangeStatStatus,
} from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Bound for every per-member read behind the Insights queries (personal stats, completion trends,
// collection breakdown, trade activity, recommendation signals). The bound is per read, and
// getPersonalStats makes eight of them, so the cap is sized for that query's total: 8 x 3000 plus
// the member row stays under Convex's 32,000 documents scanned per function. No real member comes
// close; past it the numbers undercount rather than the read failing. Where a time window matters
// (trends, trade activity by month) the newest rows are the ones kept.
export const INSIGHTS_READ_CAP = 3000;

// Insights read query (thin adapter): fetch the acting member's rows and apply the pure
// computePersonalStats projection. No write model, no mutations — Insights is read-only.
export const getPersonalStats = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(INSIGHTS_READ_CAP);

    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .take(INSIGHTS_READ_CAP);

    // Regular (non-wishlist) collections the member owns; wishlists are excluded from the count.
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(INSIGHTS_READ_CAP);
    const collectionsCount = collections.filter(
      (c) => c.isWishlist !== true,
    ).length;

    // The member participates in exchanges either as initiator or recipient.
    const asInitiator = await ctx.db
      .query("exchanges")
      .withIndex("by_initiator", (q) => q.eq("initiatorId", userId))
      .take(INSIGHTS_READ_CAP);
    const asRecipient = await ctx.db
      .query("exchanges")
      .withIndex("by_recipient", (q) => q.eq("recipientId", userId))
      .take(INSIGHTS_READ_CAP);
    const exchanges = [...asInitiator, ...asRecipient];

    const reviewsReceived = await ctx.db
      .query("reviews")
      .withIndex("by_reviewee", (q) => q.eq("revieweeId", userId))
      .take(INSIGHTS_READ_CAP);

    // The member's puzzle reviews (two-level review model): source of averageRatingGiven.
    const puzzleReviews = await ctx.db
      .query("puzzleReviews")
      .withIndex("by_user_puzzle", (q) => q.eq("userId", userId))
      .take(INSIGHTS_READ_CAP);

    const goals = await ctx.db
      .query("goals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(INSIGHTS_READ_CAP);

    return computePersonalStats({
      completions: completions.map((c) => ({
        completionTimeMinutes: isPlausibleSolveMinutes(c.completionTimeMinutes)
          ? c.completionTimeMinutes
          : undefined,
        isCompleted: c.isCompleted,
        datePrecision: c.datePrecision,
      })),
      // A copy's catalog definition: prefer the snapshot-backed PuzzleDefinitionId, fall back to the
      // legacy puzzleId so distinct-definition counting works on both new and legacy rows.
      copies: copies.map((c) => ({
        puzzleDefinitionKey: c.puzzleDefinitionId ?? (c.puzzleId as string),
      })),
      collectionsCount,
      exchanges: exchanges.map((e) => ({
        status: e.status as ExchangeStatStatus,
      })),
      // `rating` is schema-optional only for migrated text-only legacy reviews; skip those.
      puzzleReviewRatings: puzzleReviews
        .map((r) => r.rating)
        .filter((r): r is number => typeof r === "number"),
      reviewsReceived: reviewsReceived.map((r) => ({ rating: r.rating })),
      goals: goals.map((g) => ({
        isActive: g.isActive,
        targetCompletions: g.targetCompletions,
        currentCompletions: g.currentCompletions,
      })),
    });
  },
});

import { computePersonalStats, type ExchangeStatStatus } from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

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
      .collect();

    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    // Regular (non-wishlist) collections the member owns; wishlists are excluded from the count.
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const collectionsCount = collections.filter(
      (c) => c.isWishlist !== true,
    ).length;

    // The member participates in exchanges either as initiator or recipient.
    const asInitiator = await ctx.db
      .query("exchanges")
      .withIndex("by_initiator", (q) => q.eq("initiatorId", userId))
      .collect();
    const asRecipient = await ctx.db
      .query("exchanges")
      .withIndex("by_recipient", (q) => q.eq("recipientId", userId))
      .collect();
    const exchanges = [...asInitiator, ...asRecipient];

    const reviewsReceived = await ctx.db
      .query("reviews")
      .withIndex("by_reviewee", (q) => q.eq("revieweeId", userId))
      .collect();

    const goals = await ctx.db
      .query("goals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return computePersonalStats({
      completions: completions.map((c) => ({
        completionTimeMinutes: c.completionTimeMinutes,
        ratingGiven: c.rating,
        isCompleted: c.isCompleted,
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
      reviewsReceived: reviewsReceived.map((r) => ({ rating: r.rating })),
      goals: goals.map((g) => ({
        isActive: g.isActive,
        targetCompletions: g.targetCompletions,
        currentCompletions: g.currentCompletions,
      })),
    });
  },
});

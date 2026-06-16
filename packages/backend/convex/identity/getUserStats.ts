import type { MemberStatsView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";
import { requireMember } from "./requireMember";

// Identity read (thin adapter): a member's public stat card. Counts owned copies, completed
// exchanges (as initiator + recipient) and averages received review ratings. Math, rounding and
// the puzzlesAvailable == puzzlesOwned quirk match legacy users.getUserStats exactly.
// Authenticated members only. Honours the profile-visibility chokepoint (see social/privacy.ts): a
// member who went "private" has their stats hidden (returns null) from everyone except themselves
// and their mutual followers — same rule as getUserById/getProfile. Default visibility is public.
export const getUserStats = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<MemberStatsView | null> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const target = args.userId;

    // Visibility ACL: a private member's stats are visible only to themselves and mutual followers.
    if (
      target !== viewer &&
      (await profileVisibilityOf(ctx, target)) === "private" &&
      !(await areMutualFollowers(ctx, viewer, target))
    ) {
      return null;
    }

    const puzzlesOwned = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
      .collect();

    const tradesAsRequester = await ctx.db
      .query("exchanges")
      .withIndex("by_initiator", (q) => q.eq("initiatorId", args.userId))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    const tradesAsOwner = await ctx.db
      .query("exchanges")
      .withIndex("by_recipient", (q) => q.eq("recipientId", args.userId))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_reviewee", (q) => q.eq("revieweeId", args.userId))
      .collect();

    const averageRating =
      reviews.length > 0
        ? reviews.reduce((sum, review) => sum + review.rating, 0) /
          reviews.length
        : 0;

    return {
      puzzlesOwned: puzzlesOwned.length,
      puzzlesAvailable: puzzlesOwned.length,
      tradesCompleted: tradesAsRequester.length + tradesAsOwner.length,
      averageRating: Math.round(averageRating * 10) / 10,
      totalReviews: reviews.length,
    };
  },
});

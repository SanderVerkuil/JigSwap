import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side for a member's public reputation. Auth-gated (any signed-in member may view another
// member's reputation). Returns the stored projection, or a zero/default profile for a member who
// has never been reviewed, so the UI never has to special-case a missing row.
export const getReputationProfile = query({
  args: { memberId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMember(ctx);

    const profile = await ctx.db
      .query("reputationProfiles")
      .withIndex("by_member", (q) => q.eq("memberId", args.memberId))
      .unique();

    if (!profile) {
      return {
        memberId: args.memberId,
        ratingSum: 0,
        reviewCount: 0,
        averageRating: 0,
        credibility: 0,
        updatedAt: 0,
      };
    }
    return {
      memberId: profile.memberId,
      ratingSum: profile.ratingSum,
      reviewCount: profile.reviewCount,
      averageRating: profile.averageRating,
      credibility: profile.credibility,
      updatedAt: profile.updatedAt,
    };
  },
});

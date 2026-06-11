import { v } from "convex/values";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side for the reviews a member has RECEIVED (as reviewee), newest first. Auth-gated (any
// signed-in member may read another member's received reviews — they are public trust signals).
export const listReviewsForMember = query({
  args: { memberId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMember(ctx);

    return ctx.db
      .query("reviews")
      .withIndex("by_reviewee", (q) => q.eq("revieweeId", args.memberId))
      .order("desc")
      .collect();
  },
});

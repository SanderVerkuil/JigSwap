import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet } from "../social/blocks";
import { projectMemberIdentity } from "../social/privacy";

// Read side for the reviews a member has RECEIVED (as reviewee), newest first. Auth-gated (any
// signed-in member may read another member's received reviews — they are public trust signals).
// Reviews written by a member the viewer blocked or was blocked by are left out, and the
// reviewer is projected through the privacy chokepoint (salted per review) instead of being
// returned as a raw id.
export const listReviewsForMember = query({
  args: { memberId: v.id("users") },
  handler: async (ctx, args) => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const blocked = await blockedEitherWaySet(ctx, me);

    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_reviewee", (q) => q.eq("revieweeId", args.memberId))
      .order("desc")
      .collect();
    return Promise.all(
      rows
        .filter((row) => !blocked.has(row.reviewerId))
        .map(async ({ reviewerId, ...row }) => ({
          ...row,
          reviewer: await projectMemberIdentity(
            ctx,
            me,
            reviewerId,
            row.aggregateId ?? row._id,
          ),
        })),
    );
  },
});

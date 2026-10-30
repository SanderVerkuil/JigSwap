import type { ReceivedReviewView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet, blockStateBetween } from "../social/blocks";
import {
  areMutualFollowers,
  profileVisibilityOf,
  projectMemberIdentity,
} from "../social/privacy";

// Read side for the reviews a member has RECEIVED (as reviewee), newest first. Auth-gated, and the
// reviewee is gated like getUserStats (SEC-12): a member who blocked the viewer (also when the
// block is mutual) shows no reviews, and a private member's received comments reach only themself
// and their mutual followers (the ratings stay, as the profile shows them). Reviews written by a
// member the viewer blocked or was blocked by are left out. Each row is an explicit
// ReceivedReviewView: never the exchange, the reviewee or the stored row ids, which would let two
// members' lists be joined on the exchange and name an anonymous reviewer. The reviewer is
// projected through the privacy chokepoint (salted per review) instead of being returned as a raw
// id.
export const listReviewsForMember = query({
  args: { memberId: v.id("users") },
  handler: async (ctx, args): Promise<ReceivedReviewView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const reviewee = args.memberId;
    // From the reviewee's side, "byMe" = the reviewee blocked the viewer, mutual blocks included.
    if ((await blockStateBetween(ctx, reviewee, me)) === "byMe") return [];
    const showComments =
      reviewee === me ||
      (await profileVisibilityOf(ctx, reviewee)) === "public" ||
      (await areMutualFollowers(ctx, me, reviewee));
    const blocked = await blockedEitherWaySet(ctx, me);

    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_reviewee", (q) => q.eq("revieweeId", reviewee))
      .order("desc")
      .collect();
    return Promise.all(
      rows
        .filter((row) => !blocked.has(row.reviewerId))
        .map(async (row): Promise<ReceivedReviewView> => {
          const id = row.aggregateId ?? row._id;
          return {
            id,
            rating: row.rating,
            categories: {
              communication: row.categories.communication,
              packaging: row.categories.packaging,
              condition: row.categories.condition,
              timeliness: row.categories.timeliness,
            },
            ...(showComments && row.comment !== undefined
              ? { comment: row.comment }
              : {}),
            createdAt: row.createdAt,
            reviewer: await projectMemberIdentity(ctx, me, row.reviewerId, id),
          };
        }),
    );
  },
});

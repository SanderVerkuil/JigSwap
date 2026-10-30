import type { ReceivedReviewView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  blockStateBetween,
  droppedForBlock,
  viewerBlocksOf,
} from "../social/blocks";
import {
  isRevealedByOrdinaryRules,
  projectMemberIdentity,
} from "../social/privacy";

// Read side for the reviews a member has RECEIVED (as reviewee), newest first. Auth-gated, and the
// reviewee is gated like getUserStats (SEC-12): a member who blocked the viewer (also when the
// block is mutual) shows no reviews, and a private member's received reviews reach only themself
// and their mutual followers ([] for anyone else). A private member's list names their trade
// partners, so a stranger reading it would learn who the anonymous reviewer on each public
// partner's list is. Reviews by a member who blocked the viewer are left out, and so are reviews
// by a member the viewer blocked when the viewer can see who they are; one the viewer blocked but
// can't see stays the same anonymous entry, so a block never confirms who wrote it (SEC-40). Each
// row is an explicit ReceivedReviewView: never the exchange, the reviewee or the stored row ids,
// which would let two members' lists be joined on the exchange and name an anonymous reviewer.
// The reviewer is projected through the privacy chokepoint (salted per review) instead of being
// returned as a raw id.
export const listReviewsForMember = query({
  args: { memberId: v.id("users") },
  handler: async (ctx, args): Promise<ReceivedReviewView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const reviewee = args.memberId;
    // From the reviewee's side, "byMe" = the reviewee blocked the viewer, mutual blocks included.
    if ((await blockStateBetween(ctx, reviewee, me)) === "byMe") return [];
    if (
      reviewee !== me &&
      !(await isRevealedByOrdinaryRules(ctx, me, reviewee))
    ) {
      return [];
    }
    const blocks = await viewerBlocksOf(ctx, me);

    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_reviewee", (q) => q.eq("revieweeId", reviewee))
      .order("desc")
      .collect();
    const views = await Promise.all(
      rows
        .filter((row) => !blocks.byThem.has(row.reviewerId))
        .map(async (row) => {
          const id = row.aggregateId ?? row._id;
          const view: ReceivedReviewView = {
            id,
            rating: row.rating,
            categories: {
              communication: row.categories.communication,
              packaging: row.categories.packaging,
              condition: row.categories.condition,
              timeliness: row.categories.timeliness,
            },
            ...(row.comment !== undefined ? { comment: row.comment } : {}),
            createdAt: row.createdAt,
            reviewer: await projectMemberIdentity(ctx, me, row.reviewerId, id),
          };
          return { reviewerId: row.reviewerId, view };
        }),
    );
    return views
      .filter(
        ({ reviewerId, view }) =>
          !droppedForBlock(blocks, reviewerId, !view.reviewer.anonymous),
      )
      .map(({ view }) => view);
  },
});

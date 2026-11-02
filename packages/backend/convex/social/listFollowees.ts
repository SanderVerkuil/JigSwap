import type { FollowEdgeView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { blockedEitherWaySet } from "./blocks";
import { FOLLOW_LIST_CAP, followExists, toFollowEdgeView } from "./readViews";

// Read side: the members the CALLER follows, for the pickers that offer them all (the inbox's "Message
// a member", quick start). The People page pages its network instead (social/listMyNetwork). Each
// entry resolves the FOLLOWEE's display name and says whether they follow back (from the pair itself,
// so it is right however many followers the caller has). Returns typed FollowEdgeView DTOs.
//
// SECURITY (SEC-13): a member reads only their own following list, so the query takes no member
// id. Another member's list would name every member they follow, private members included, to any
// signed-in caller (the edge view projects no counterparty). Members blocked either way are left
// out (spec 2.6).
export const listFollowees = query({
  args: {},
  handler: async (ctx): Promise<FollowEdgeView[]> => {
    const viewer = (await requireMember(ctx)) as unknown as Id<"users">;
    const blockedIds = await blockedEitherWaySet(ctx, viewer);

    // Bounded read: only the newest FOLLOW_LIST_CAP edges, handed back oldest-first as before.
    const rows = (
      await ctx.db
        .query("follows")
        .withIndex("by_follower", (q) => q.eq("followerId", viewer))
        .order("desc")
        .take(FOLLOW_LIST_CAP)
    ).reverse();
    return Promise.all(
      rows
        .filter((r) => !blockedIds.has(r.followeeId))
        .map(async (r) => ({
          ...(await toFollowEdgeView(
            ctx,
            r.aggregateId,
            r.followeeId,
            r.createdAt,
          )),
          followsYou: await followExists(ctx, r.followeeId, viewer),
        })),
    );
  },
});

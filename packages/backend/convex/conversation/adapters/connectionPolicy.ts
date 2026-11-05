import type { ConnectionPolicy, MemberId } from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { isBlockedEitherWay } from "../../social/blocks";
import { projectMemberIdentity } from "../../social/privacy";
import { participantsKeyOf } from "./threadMapper";

// Driven adapter for the ConnectionPolicy port. "Connected" = mutual follow, shared circle, or
// an existing thread between the pair (exchange threads are opened on proposal, so "we have an
// exchange together" reduces to a pair lookup) with a recipient the initiator may see. The
// pair-thread clause also keeps an existing DM reachable after an unfollow: the use case consults
// this policy BEFORE its idempotency lookup. It counts only while projectMemberIdentity reveals
// the recipient to the initiator (SEC-80): for a hidden or departed partner a yes would confirm
// which member an anonymous exchange partner is, so they answer like a stranger. A per-trade
// reveal does not count either; it applies inside that exchange only (exchange/tradeParty.ts).
// The policy only READS, so it is typed over QueryCtx; mutation callers pass their MutationCtx
// unchanged (structurally assignable) and the canMessage read model can share the adapter.
export const convexConnectionPolicy = (ctx: QueryCtx): ConnectionPolicy => ({
  async canMessage(initiator: MemberId, recipient: MemberId) {
    const a = initiator as unknown as Id<"users">;
    const b = recipient as unknown as Id<"users">;

    // A block either way revokes every clause below, including the pair-thread one (spec 2.6).
    if (await isBlockedEitherWay(ctx, a, b)) return false;

    // Mutual follow. `.first()` keeps the check duplicate-tolerant (same as isFollowing).
    const follows = async (x: Id<"users">, y: Id<"users">) =>
      (await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", x).eq("followeeId", y),
        )
        .first()) !== null;
    if ((await follows(a, b)) && (await follows(b, a))) return true;

    // Any existing thread between the pair, regardless of subject kind, while the recipient is
    // not anonymous to the initiator.
    const pairThread = await ctx.db
      .query("threads")
      .withIndex("by_participants_key", (q) =>
        q.eq("participantsKey", participantsKeyOf([initiator, recipient])),
      )
      .first();
    if (
      pairThread &&
      !(await projectMemberIdentity(ctx, a, b, pairThread.aggregateId))
        .anonymous
    ) {
      return true;
    }

    // Shared circle: any of the initiator's circles that also contains the recipient.
    const mine = await ctx.db
      .query("circleMembers")
      .withIndex("by_member", (q) => q.eq("memberId", a))
      .collect();
    for (const membership of mine) {
      const shared = await ctx.db
        .query("circleMembers")
        .withIndex("by_circle_member", (q) =>
          q
            .eq("circleAggregateId", membership.circleAggregateId)
            .eq("memberId", b),
        )
        .first();
      if (shared) return true;
    }
    return false;
  },
});

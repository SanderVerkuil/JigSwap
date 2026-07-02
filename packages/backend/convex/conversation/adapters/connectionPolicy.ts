import type { ConnectionPolicy, MemberId } from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { participantsKeyOf } from "./threadMapper";

// Driven adapter for the ConnectionPolicy port. "Connected" = mutual follow, shared circle, or
// any existing thread between the pair (exchange threads are opened on proposal, so "we have an
// exchange together" reduces to a pair lookup). The pair-thread clause also keeps an existing DM
// reachable after an unfollow: the use case consults this policy BEFORE its idempotency lookup.
export const convexConnectionPolicy = (ctx: MutationCtx): ConnectionPolicy => ({
  async canMessage(initiator: MemberId, recipient: MemberId) {
    const a = initiator as unknown as Id<"users">;
    const b = recipient as unknown as Id<"users">;

    // Mutual follow. `.first()` keeps the check duplicate-tolerant (same as isFollowing).
    const follows = async (x: Id<"users">, y: Id<"users">) =>
      (await ctx.db
        .query("follows")
        .withIndex("by_follower_followee", (q) =>
          q.eq("followerId", x).eq("followeeId", y),
        )
        .first()) !== null;
    if ((await follows(a, b)) && (await follows(b, a))) return true;

    // Any existing thread between the pair, regardless of subject kind.
    const pairThread = await ctx.db
      .query("threads")
      .withIndex("by_participants_key", (q) =>
        q.eq("participantsKey", participantsKeyOf([initiator, recipient])),
      )
      .first();
    if (pairThread) return true;

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

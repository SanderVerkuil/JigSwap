import {
  makeCancelExchange,
  makeDeclineExchange,
  makeUnfollowMember,
  toExchangeId,
  toMemberId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { convexExchangeRepository } from "../exchange/adapters/convexExchangeRepository";
import { inProcessEventPublisher as exchangeEventPublisher } from "../exchange/adapters/inProcessEventPublisher";
import { toConvexError as toExchangeConvexError } from "../exchange/errors";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { declineFollowRequestUseCase } from "./declineFollowRequest";
import { toConvexError } from "./errors";

/** A member may block at most this many others (spec 2.6). */
export const MAX_BLOCKS = 1000;

// Block a member (spec 2.6): silent, no notification to the blocked member. Idempotent: blocking
// an already-blocked member changes nothing. In the same transaction it severs the social
// connection both ways (follow edges through the unfollow use case, pending follow requests
// declined) and closes pending exchange proposals between the pair, always acting as the blocker
// so nothing is attributed to the blocked member: proposals the blocked member sent are DECLINED
// (it reads as an ordinary decline), proposals the blocker sent are CANCELLED, through the
// exchange use cases so the usual system message and notification flow. Accepted exchanges and
// loans are left alone: they can still be completed, only their chat closes.
export const blockMember = mutation({
  args: { memberId: v.id("users") },
  handler: async (ctx, { memberId: blockedId }): Promise<void> => {
    const blockerId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (blockerId === blockedId) {
      throw new ConvexError({
        code: "CannotBlockSelf",
        message: "You can't block yourself",
      });
    }
    // Before the existence check, so probing member ids is throttled too.
    await enforceRateLimit(ctx, "blockToggle", blockerId);
    if ((await ctx.db.get(blockedId)) === null) {
      throw new ConvexError({
        code: "MemberNotFound",
        message: "Member not found",
      });
    }

    const existing = await ctx.db
      .query("blocks")
      .withIndex("by_pair", (q) =>
        q.eq("blockerId", blockerId).eq("blockedId", blockedId),
      )
      .first();
    if (existing) return;

    const current = await ctx.db
      .query("blocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", blockerId))
      .take(MAX_BLOCKS);
    if (current.length >= MAX_BLOCKS) {
      throw new ConvexError({
        code: "BlockLimitReached",
        message: `You can block at most ${MAX_BLOCKS} members`,
      });
    }

    await ctx.db.insert("blocks", {
      blockerId,
      blockedId,
      createdAt: Date.now(),
    });
    for (const [a, b] of [
      [blockerId, blockedId],
      [blockedId, blockerId],
    ] as const) {
      await removeFollow(ctx, a, b);
      await declinePendingRequest(ctx, a, b);
    }
    // The blocker's own proposals: cancelled. Proposals sent to the blocker: declined.
    await closePendingProposals(
      ctx,
      blockerId,
      blockedId,
      makeCancelExchange,
      blockerId,
    );
    await closePendingProposals(
      ctx,
      blockedId,
      blockerId,
      makeDeclineExchange,
      blockerId,
    );
  },
});

// Delete the follower -> followee edge, if any, through the unfollow use case (MemberUnfollowed).
// A legacy edge without an aggregateId can't be addressed by the follow repository (its lookups
// key on aggregateId), so it is deleted directly.
const removeFollow = async (
  ctx: MutationCtx,
  followerId: Id<"users">,
  followeeId: Id<"users">,
) => {
  const edge = await ctx.db
    .query("follows")
    .withIndex("by_follower_followee", (q) =>
      q.eq("followerId", followerId).eq("followeeId", followeeId),
    )
    .first();
  if (!edge) return;
  if (edge.aggregateId === undefined) {
    await ctx.db.delete(edge._id);
    return;
  }
  const result = await makeUnfollowMember({
    follows: convexFollowRepository(ctx),
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  })({
    followerId: toMemberId(followerId),
    followeeId: toMemberId(followeeId),
  });
  if (result.isErr) throw toConvexError(result.error);
};

// Decline the requester -> target follow request while it is pending, as its target (declines
// are silent: nothing is notified).
const declinePendingRequest = async (
  ctx: MutationCtx,
  requesterId: Id<"users">,
  targetId: Id<"users">,
) => {
  const request = await ctx.db
    .query("followRequests")
    .withIndex("by_requester_target", (q) =>
      q.eq("requesterId", requesterId).eq("targetId", targetId),
    )
    .first();
  if (request?.status !== "pending") return;
  await declineFollowRequestUseCase(ctx, toMemberId(targetId), {
    requestId: request.aggregateId,
  });
};

// Close every still-proposed exchange the initiator sent the recipient through `make`, as `actorId`
// (cancel is the initiator's transition, decline the recipient's). ExchangeCancelled /
// ExchangeRejected post the system message.
const closePendingProposals = async (
  ctx: MutationCtx,
  initiatorId: Id<"users">,
  recipientId: Id<"users">,
  make: typeof makeCancelExchange | typeof makeDeclineExchange,
  actorId: Id<"users">,
) => {
  const proposals = await ctx.db
    .query("exchanges")
    .withIndex("by_initiator", (q) => q.eq("initiatorId", initiatorId))
    .filter((q) =>
      q.and(
        q.eq(q.field("recipientId"), recipientId),
        q.eq(q.field("status"), "proposed"),
      ),
    )
    .collect();
  const close = make({
    exchanges: convexExchangeRepository(ctx),
    events: exchangeEventPublisher(ctx),
    clock: systemClock,
  });
  for (const proposal of proposals) {
    // Pre-aggregateId legacy rows aren't reachable by the domain repository (so no lifecycle
    // mutation, accept included, can act on them either).
    if (!proposal.aggregateId) continue;
    const result = await close({
      exchangeId: toExchangeId(proposal.aggregateId),
      actingMemberId: toMemberId(actorId),
    });
    if (result.isErr) throw toExchangeConvexError(result.error);
  }
};

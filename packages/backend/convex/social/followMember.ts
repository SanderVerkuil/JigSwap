import {
  makeFollowMember,
  makeRequestFollow,
  toMemberId,
  type MemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import {
  followIdGenerator,
  followRequestIdGenerator,
} from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { assertPairNotBlocked } from "./blocks";
import { toConvexError } from "./errors";
import { profileVisibilityOf } from "./privacy";

// Composition root for following a member — now visibility-aware (spec: hybrid follow
// model). Public target → instant follow, exactly as before. Private target → a pending
// FollowRequest instead, UNLESS the target already follows the actor (they initiated
// contact; a follow-back completes mutuality and must not dead-end in a request).
// The follower is derived from auth, never the client. The body is shared with notifications/act
// (Follow back from a notification) so both paths run the exact same rules.
// Rate limits (SEC-23): the member's followToggle bucket, then the per-pair followPair bucket. The
// pair is charged before the public/private branch and before the request dedupe, so every
// outcome (instant follow, new request, an idempotent repeat, a silently declined request) costs
// the same and a refusal can't tell them apart.
export const followMemberUseCase = async (
  ctx: MutationCtx,
  followerId: MemberId,
  args: { followeeId: Id<"users"> },
): Promise<{ kind: "followed" | "requested"; id: string }> => {
  await enforceRateLimit(ctx, "followToggle", followerId);
  await assertPairNotBlocked(ctx, followerId, args.followeeId);
  await enforceRateLimit(ctx, "followPair", `${followerId}:${args.followeeId}`);
  const visibility = await profileVisibilityOf(ctx, args.followeeId);
  const reverseEdge = await ctx.db
    .query("follows")
    .withIndex("by_follower_followee", (q) =>
      q
        .eq("followerId", args.followeeId)
        .eq("followeeId", followerId as unknown as Id<"users">),
    )
    .first();

  if (visibility === "private" && !reverseEdge) {
    const requestFollowUseCase = makeRequestFollow({
      requests: convexFollowRequestRepository(ctx),
      follows: convexFollowRepository(ctx),
      requestIds: followRequestIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await requestFollowUseCase({
      requesterId: followerId,
      targetId: toMemberId(args.followeeId),
    });
    if (result.isErr) throw toConvexError(result.error);
    return { kind: "requested", id: result.value as string };
  }

  const followUseCase = makeFollowMember({
    follows: convexFollowRepository(ctx),
    followIds: followIdGenerator,
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });
  const result = await followUseCase({
    followerId,
    followeeId: toMemberId(args.followeeId),
  });
  if (result.isErr) throw toConvexError(result.error);
  return { kind: "followed", id: result.value as string };
};

export const followMember = mutation({
  args: { followeeId: v.id("users") },
  handler: async (
    ctx,
    args,
  ): Promise<{ kind: "followed" | "requested"; id: string }> =>
    followMemberUseCase(ctx, await requireMember(ctx), args),
});

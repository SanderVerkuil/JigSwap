import {
  makeApproveFollowRequest,
  toFollowRequestId,
  type MemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import { followIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { assertPairNotBlocked } from "./blocks";
import { toConvexError } from "./errors";

// Composition root: the acting member approves a follow request they received. The actor
// ACL (must be the request's target) is enforced in the use case against the loaded
// aggregate. Returns what the UI needs to offer a one-tap follow-back. The body is shared with
// notifications/act (Approve from a notification).
export const approveFollowRequestUseCase = async (
  ctx: MutationCtx,
  actorId: MemberId,
  args: { requestId: string },
): Promise<{ requesterId: string; alreadyFollowsBack: boolean }> => {
  const request = await ctx.db
    .query("followRequests")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.requestId))
    .unique();
  if (request) {
    await assertPairNotBlocked(ctx, request.requesterId, request.targetId);
  }
  const approve = makeApproveFollowRequest({
    requests: convexFollowRequestRepository(ctx),
    follows: convexFollowRepository(ctx),
    followIds: followIdGenerator,
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });
  const result = await approve({
    requestId: toFollowRequestId(args.requestId),
    actorId,
  });
  if (result.isErr) throw toConvexError(result.error);
  return {
    requesterId: result.value.requesterId as string,
    alreadyFollowsBack: result.value.alreadyFollowsBack,
  };
};

export const approveFollowRequest = mutation({
  args: { requestId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ requesterId: string; alreadyFollowsBack: boolean }> =>
    approveFollowRequestUseCase(ctx, await requireMember(ctx), args),
});

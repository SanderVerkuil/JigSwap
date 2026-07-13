import { makeApproveFollowRequest, toFollowRequestId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import { followIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root: the acting member approves a follow request they received. The actor
// ACL (must be the request's target) is enforced in the use case against the loaded
// aggregate. Returns what the UI needs to offer a one-tap follow-back.
export const approveFollowRequest = mutation({
  args: { requestId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ requesterId: string; alreadyFollowsBack: boolean }> => {
    const actorId = await requireMember(ctx);
    const approveFollowRequestUseCase = makeApproveFollowRequest({
      requests: convexFollowRequestRepository(ctx),
      follows: convexFollowRepository(ctx),
      followIds: followIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await approveFollowRequestUseCase({
      requestId: toFollowRequestId(args.requestId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
    return {
      requesterId: result.value.requesterId as string,
      alreadyFollowsBack: result.value.alreadyFollowsBack,
    };
  },
});

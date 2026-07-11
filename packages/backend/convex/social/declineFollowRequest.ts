import { makeDeclineFollowRequest, toFollowRequestId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root: the acting member declines a follow request they received. Silent by
// design: no notification is emitted anywhere downstream.
export const declineFollowRequest = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const declineFollowRequestUseCase = makeDeclineFollowRequest({
      requests: convexFollowRequestRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await declineFollowRequestUseCase({
      requestId: toFollowRequestId(args.requestId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

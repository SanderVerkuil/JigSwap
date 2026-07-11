import { makeCancelFollowRequest, toFollowRequestId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import { toConvexError } from "./errors";

// Composition root: the acting member withdraws a follow request they sent.
export const cancelFollowRequest = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    const cancelFollowRequestUseCase = makeCancelFollowRequest({
      requests: convexFollowRequestRepository(ctx),
    });
    const result = await cancelFollowRequestUseCase({
      requestId: toFollowRequestId(args.requestId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

import { makeCancelFollowRequest, toFollowRequestId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enforceRateLimit } from "../lib/rateLimits";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root: the acting member withdraws a follow request they sent. Each cancel counts
// against the member's followToggle limit (SEC-23); the per-pair limit charges requests only.
export const cancelFollowRequest = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const actorId = await requireMember(ctx);
    await enforceRateLimit(ctx, "followToggle", actorId);
    const cancelFollowRequestUseCase = makeCancelFollowRequest({
      requests: convexFollowRequestRepository(ctx),
      clock: systemClock,
    });
    const result = await cancelFollowRequestUseCase({
      requestId: toFollowRequestId(args.requestId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

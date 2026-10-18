import { makeLeaveCircle, toCircleId, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for leaving a circle. The leaver is the authenticated member (nobody can take
// someone else out through this path); the aggregate refuses the owner and non-members.
export const leaveCircle = mutation({
  args: {
    circleId: v.string(),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    const leaveCircle = makeLeaveCircle({
      circles: convexCircleRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await leaveCircle({
      circleId: toCircleId(args.circleId),
      memberId: memberId as MemberId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

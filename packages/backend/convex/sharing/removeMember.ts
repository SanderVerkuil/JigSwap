import { makeRemoveMember, toCircleId, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { seatMemberId } from "./circleAccess";
import { toConvexError } from "./errors";

// Composition root for removing a member from a circle. The actor is derived from auth; the
// aggregate gates the removal on Admin and refuses to remove the owner. The seat is named by
// `memberId` or by `membershipId` (a departed seat's view has no user id).
export const removeMember = mutation({
  args: {
    circleId: v.string(),
    memberId: v.optional(v.id("users")),
    membershipId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireMember(ctx);
    const memberId = await seatMemberId(ctx, args);

    const removeMember = makeRemoveMember({
      circles: convexCircleRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await removeMember({
      circleId: toCircleId(args.circleId),
      actorId: actorId as MemberId,
      memberId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

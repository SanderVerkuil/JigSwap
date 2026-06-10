import { type CircleId, makeRemoveMember, type MemberId, toId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { toConvexError } from "./errors";

// Composition root for removing a member from a circle. The actor is derived from auth; the
// aggregate gates the removal on Admin and refuses to remove the owner.
export const removeMember = mutation({
  args: {
    circleId: v.string(),
    memberId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const actorId = await requireMember(ctx);

    const removeMember = makeRemoveMember({
      circles: convexCircleRepository(ctx),
      events: inProcessEventPublisher(ctx),
    });

    const result = await removeMember({
      circleId: toId<"CircleId">(args.circleId) as CircleId,
      actorId: actorId as MemberId,
      memberId: toId<"MemberId">(args.memberId) as MemberId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

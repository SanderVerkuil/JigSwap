import {
  makeRemoveMember,
  type MemberId,
  toCircleId,
  toMemberId,
} from "@jigswap/domain";
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
      circleId: toCircleId(args.circleId),
      actorId: actorId as MemberId,
      memberId: toMemberId(args.memberId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

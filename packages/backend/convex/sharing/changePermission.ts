import {
  makeChangePermission,
  type MemberId,
  type PermissionLevel,
  toCircleId,
  toMemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { toConvexError } from "./errors";

// Composition root for changing a member's permission within a circle. The actor is derived from
// auth; the aggregate gates the change on Admin and refuses the owner / no-op changes.
export const changePermission = mutation({
  args: {
    circleId: v.string(),
    memberId: v.id("users"),
    permission: v.union(
      v.literal("ViewOnly"),
      v.literal("Exchange"),
      v.literal("Admin"),
    ),
  },
  handler: async (ctx, args) => {
    const actorId = await requireMember(ctx);

    const changePermission = makeChangePermission({
      circles: convexCircleRepository(ctx),
      events: inProcessEventPublisher(ctx),
    });

    const result = await changePermission({
      circleId: toCircleId(args.circleId),
      actorId: actorId as MemberId,
      memberId: toMemberId(args.memberId),
      permission: args.permission as PermissionLevel,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

import {
  makeChangePermission,
  toCircleId,
  type MemberId,
  type PermissionLevel,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import {
  inProcessEventPublisher,
  withdrawInvitesFrom,
} from "./adapters/inProcessEventPublisher";
import { seatMemberId } from "./circleAccess";
import { toConvexError } from "./errors";

// Composition root for changing a member's permission within a circle. The actor is derived from
// auth; the aggregate gates the change on Admin and refuses the owner / no-op changes. The seat is
// named by `memberId` or by `membershipId` (a departed seat's view has no user id).
export const changePermission = mutation({
  args: {
    circleId: v.string(),
    memberId: v.optional(v.id("users")),
    membershipId: v.optional(v.string()),
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

    const circleId = toCircleId(args.circleId);
    const memberId = await seatMemberId(ctx, args);
    const result = await changePermission({
      circleId,
      actorId: actorId as MemberId,
      memberId,
      permission: args.permission as PermissionLevel,
    });
    if (result.isErr) throw toConvexError(result.error);
    // A member who is no longer an Admin can't stand behind their pending invites any more.
    if (args.permission !== "Admin") {
      await withdrawInvitesFrom(ctx, circleId, memberId);
    }
  },
});

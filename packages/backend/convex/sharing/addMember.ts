import {
  makeAddMember,
  type MemberId,
  type PermissionLevel,
  toCircleId,
  toMemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import { membershipIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for adding a member to a circle. The actor is derived from auth; the aggregate
// gates the add on the actor holding Admin. `circleId` is the domain CircleId aggregateId;
// `memberId` is the target user's _id (the resolved MemberId).
export const addMember = mutation({
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

    const addMember = makeAddMember({
      circles: convexCircleRepository(ctx),
      membershipIds: membershipIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await addMember({
      circleId: toCircleId(args.circleId),
      actorId: actorId as MemberId,
      memberId: toMemberId(args.memberId),
      permission: args.permission as PermissionLevel,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

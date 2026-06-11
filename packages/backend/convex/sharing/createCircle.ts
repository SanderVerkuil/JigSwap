import { makeCreateCircle, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCircleRepository } from "./adapters/convexCircleRepository";
import {
  circleIdGenerator,
  membershipIdGenerator,
} from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";

// Composition root for creating a friend circle: authenticate -> wire adapters -> call the use
// case -> return the new CircleId. The creator becomes the owner (implicitly Admin) and first
// member; all behaviour lives in the (Convex-free) domain/application layers.
export const createCircle = mutation({
  args: { name: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const ownerId = await requireMember(ctx); // owner derived from auth, never the client

    const createCircle = makeCreateCircle({
      circles: convexCircleRepository(ctx),
      circleIds: circleIdGenerator,
      membershipIds: membershipIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await createCircle({
      ownerId: ownerId as MemberId,
      name: args.name,
    });
    // CreateCircle's error channel is `never`; the result is always ok (narrow to access value).
    if (result.isErr) throw result.error;
    return result.value as string;
  },
});

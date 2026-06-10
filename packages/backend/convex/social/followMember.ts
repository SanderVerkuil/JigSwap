import { type MemberId, makeFollowMember, toId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { followIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for following a member: authenticate -> wire adapters -> call the use case ->
// map result. The follower is derived from auth, never the client. Returns the new edge id.
export const followMember = mutation({
  args: { followeeId: v.id("users") },
  handler: async (ctx, args) => {
    const followerId = await requireMember(ctx);

    const followMemberUseCase = makeFollowMember({
      follows: convexFollowRepository(ctx),
      followIds: followIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await followMemberUseCase({
      followerId,
      followeeId: toId<"MemberId">(args.followeeId) as MemberId,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});

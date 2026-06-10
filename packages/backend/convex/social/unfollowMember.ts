import { type MemberId, makeUnfollowMember, toId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for unfollowing a member: authenticate -> wire adapters -> call the use case.
// The follower is derived from auth; NotFollowing surfaces as a transport error.
export const unfollowMember = mutation({
  args: { followeeId: v.id("users") },
  handler: async (ctx, args) => {
    const followerId = await requireMember(ctx);

    const unfollowMemberUseCase = makeUnfollowMember({
      follows: convexFollowRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await unfollowMemberUseCase({
      followerId,
      followeeId: toId<"MemberId">(args.followeeId) as MemberId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

import {
  makeFollowMember,
  makeRequestFollow,
  toMemberId,
} from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexFollowRepository } from "./adapters/convexFollowRepository";
import { convexFollowRequestRepository } from "./adapters/convexFollowRequestRepository";
import {
  followIdGenerator,
  followRequestIdGenerator,
} from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";
import { profileVisibilityOf } from "./privacy";

// Composition root for following a member — now visibility-aware (spec: hybrid follow
// model). Public target → instant follow, exactly as before. Private target → a pending
// FollowRequest instead, UNLESS the target already follows the actor (they initiated
// contact; a follow-back completes mutuality and must not dead-end in a request).
// The follower is derived from auth, never the client.
export const followMember = mutation({
  args: { followeeId: v.id("users") },
  handler: async (
    ctx,
    args,
  ): Promise<{ kind: "followed" | "requested"; id: string }> => {
    const followerId = await requireMember(ctx);

    const visibility = await profileVisibilityOf(ctx, args.followeeId);
    const reverseEdge = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q
          .eq("followerId", args.followeeId)
          .eq("followeeId", followerId as unknown as Id<"users">),
      )
      .first();

    if (visibility === "private" && !reverseEdge) {
      const requestFollowUseCase = makeRequestFollow({
        requests: convexFollowRequestRepository(ctx),
        follows: convexFollowRepository(ctx),
        requestIds: followRequestIdGenerator,
        events: inProcessEventPublisher(ctx),
        clock: systemClock,
      });
      const result = await requestFollowUseCase({
        requesterId: followerId,
        targetId: toMemberId(args.followeeId),
      });
      if (result.isErr) throw toConvexError(result.error);
      return { kind: "requested", id: result.value as string };
    }

    const followMemberUseCase = makeFollowMember({
      follows: convexFollowRepository(ctx),
      followIds: followIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await followMemberUseCase({
      followerId,
      followeeId: toMemberId(args.followeeId),
    });
    if (result.isErr) throw toConvexError(result.error);
    return { kind: "followed", id: result.value as string };
  },
});

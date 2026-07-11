import { COOLDOWN_MS } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { profileVisibilityOf } from "./privacy";

// Read side: the composite relation state the FollowButton needs for a target member.
// SILENT-DECLINE MASKING: a declined request still inside its cooldown is reported as
// pending — the requester must not be able to distinguish a decline from no answer,
// including by probing this query.
export const getFollowRelation = query({
  args: { memberId: v.id("users") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    following: boolean;
    followsYou: boolean;
    targetIsPrivate: boolean;
    pendingRequest: { requestId: string; requestedAt: number } | null;
  }> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    const edge = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", me).eq("followeeId", args.memberId),
      )
      .first();
    const reverse = await ctx.db
      .query("follows")
      .withIndex("by_follower_followee", (q) =>
        q.eq("followerId", args.memberId).eq("followeeId", me),
      )
      .first();
    const visibility = await profileVisibilityOf(ctx, args.memberId);

    const request = await ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q.eq("requesterId", me).eq("targetId", args.memberId),
      )
      .first();

    const now = Date.now();
    const pendingRequest =
      request &&
      (request.status === "pending" ||
        // A declined request masks as pending ONLY while it is still in cooldown AND has not
        // been cancelled. A cancel stamps cancelledAt: the requester withdrew, so the relation
        // must read as no pending request (until a re-request inside the cooldown resumes it).
        (request.status === "declined" &&
          request.cancelledAt === undefined &&
          request.respondedAt !== undefined &&
          now - request.respondedAt < COOLDOWN_MS))
        ? { requestId: request.aggregateId, requestedAt: request.createdAt }
        : null;

    return {
      following: edge !== null,
      followsYou: reverse !== null,
      targetIsPrivate: visibility === "private",
      pendingRequest,
    };
  },
});

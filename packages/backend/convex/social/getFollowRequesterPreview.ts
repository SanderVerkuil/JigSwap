import type { FollowRequesterPreviewView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";

// Read side: who is asking to follow the viewer, so they can decide Approve/Decline on an incoming
// request from a private member. Authorized ONLY by a pending requester -> viewer follow request;
// every other case (no request, answered, withdrawn, the other direction, deleted or deactivated
// requester) returns null without saying which, so the query cannot probe the follow graph.
// Identity fields only: never email, bio, location, counts or follower lists.
export const getFollowRequesterPreview = query({
  args: { requesterId: v.id("users") },
  handler: async (ctx, args): Promise<FollowRequesterPreviewView | null> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;

    const pending = await ctx.db
      .query("followRequests")
      .withIndex("by_requester_target", (q) =>
        q.eq("requesterId", args.requesterId).eq("targetId", viewerId),
      )
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (!pending) return null;

    const user = await ctx.db.get(args.requesterId);
    if (!user || !user.isActive) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", user._id))
      .unique();

    const displayName = memberDisplayNameOf(user, profile);
    return {
      memberId: user._id,
      ...(displayName !== undefined ? { displayName } : {}),
      handle: user.slug ?? user.username ?? user._id,
      ...(user.avatar !== undefined ? { avatar: user.avatar } : {}),
      memberSince: user.createdAt,
      visibility: profile?.visibility ?? "public",
      requestedAt: pending.createdAt,
    };
  },
});

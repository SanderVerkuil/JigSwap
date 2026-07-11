import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { establishMutualFollow } from "./establishMutualFollow";

// Post-signup invite redemption: called once by the client (InviteRedeemer) when a localStorage
// token survives the Clerk redirect. Idempotent per member via inviteRedemptions.by_new_member —
// a member can only ever be attributed to one inviter. Revoked/self/unknown tokens no-op.
export const redeemInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const prior = await ctx.db
      .query("inviteRedemptions")
      .withIndex("by_new_member", (q) => q.eq("newMemberId", memberId))
      .unique();
    if (prior !== null) return { redeemed: false };

    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (
      link === null ||
      link.revokedAt !== undefined ||
      link.ownerId === memberId
    ) {
      return { redeemed: false };
    }

    await ctx.db.insert("inviteRedemptions", {
      inviteLinkId: link._id,
      inviterId: link.ownerId,
      newMemberId: memberId,
      createdAt: Date.now(),
    });
    await establishMutualFollow(ctx, link.ownerId, memberId);
    await ctx.db.patch(link._id, {
      signupsAttributed: link.signupsAttributed + 1,
      followsEstablished: link.followsEstablished + 1,
    });
    return { redeemed: true, inviterId: link.ownerId };
  },
});

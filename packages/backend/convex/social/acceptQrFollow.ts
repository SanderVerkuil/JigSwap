import { v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { establishMutualFollow } from "./establishMutualFollow";

// A logged-in member scanned someone's QR (or opened their invite link): one tap establishes the
// mutual follow. Own/invalid/revoked tokens are silently ignored — never an error, the landing
// page just shows nothing special.
export const acceptQrFollow = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (
      link === null ||
      link.revokedAt !== undefined ||
      link.ownerId === memberId
    ) {
      return { established: false };
    }

    await establishMutualFollow(ctx, link.ownerId, memberId);
    await ctx.db.patch(link._id, {
      followsEstablished: link.followsEstablished + 1,
    });
    return { established: true };
  },
});

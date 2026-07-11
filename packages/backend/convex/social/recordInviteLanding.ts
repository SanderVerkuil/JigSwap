import { v } from "convex/values";
import { mutation } from "../_generated/server";

// PUBLIC (no auth): fire-and-forget landing counter for the growth-loop metrics. Invalid or
// revoked tokens are silently ignored (the landing page degrades to the plain teaser).
export const recordInviteLanding = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (link === null || link.revokedAt !== undefined) return;
    await ctx.db.patch(link._id, { landingViews: link.landingViews + 1 });
  },
});

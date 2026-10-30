import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { chargeBudget, inviteLandingBudget } from "../lib/rateLimits";

// PUBLIC (no auth): fire-and-forget landing counter for the growth-loop metrics. Invalid or
// revoked tokens are silently ignored (the landing page degrades to the plain teaser). Each link
// counts at most its hourly landing budget; landings past it are dropped without a write.
export const recordInviteLanding = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (link === null || link.revokedAt !== undefined) return;
    if ((await chargeBudget(ctx, inviteLandingBudget(link._id))) !== null) {
      return;
    }
    await ctx.db.patch(link._id, { landingViews: link.landingViews + 1 });
  },
});

import { v } from "convex/values";
import { query } from "../_generated/server";

// PUBLIC (no auth): tells the /members/$handle landing whether ?invite=<token> is a live invite
// for THIS profile. memberId pins the token to the viewed profile so a token can't decorate
// someone else's page. Returns only a boolean — never the token owner's data.
export const getInviteContext = query({
  args: { token: v.string(), memberId: v.id("users") },
  handler: async (ctx, { token, memberId }) => {
    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    return {
      valid:
        link !== null &&
        link.revokedAt === undefined &&
        link.ownerId === memberId,
    };
  },
});

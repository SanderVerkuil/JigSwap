import { v } from "convex/values";
import { query } from "../_generated/server";
import { membershipOf } from "../household/memberships";
import { isLiveLink, isNetworkLink } from "./inviteLinkRules";

// PUBLIC (no auth): tells the /members/$handle landing whether ?invite=<token> is a live invite
// for THIS profile, and whether it is the member's network link or a household link. memberId
// pins the token to the viewed profile so a token can't decorate someone else's page. Returns no
// owner or household data. A revoked, expired or used token is invalid, and so is a household
// link whose owner is no longer the admin of the household it was minted for (the same rule as
// social/householdLinkInvite); a household token keeps its kind so the landing can say "expired
// or already used".
export const getInviteContext = query({
  args: { token: v.string(), memberId: v.id("users") },
  handler: async (
    ctx,
    { token, memberId },
  ): Promise<{ valid: boolean; kind: "network" | "household" }> => {
    const link = await ctx.db
      .query("inviteLinks")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (link === null || link.ownerId !== memberId) {
      return { valid: false, kind: "network" };
    }
    if (isNetworkLink(link)) {
      return { valid: isLiveLink(link, Date.now()), kind: "network" };
    }
    const owner = await membershipOf(ctx, link.ownerId);
    return {
      valid:
        isLiveLink(link, Date.now()) &&
        owner?.householdId === link.context?.householdId &&
        owner?.role === "admin",
      kind: "household",
    };
  },
});

import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import {
  resolveHouseholdLink,
  type HouseholdLinkState,
} from "./householdLinkInvite";

// The signed-in landing for a household invite link: "<inviter> invited you to their household"
// with Accept / Decline, or why the member can't join. The inviter's name is returned only while
// the link is live (can-accept, already-in-household). The household's own name is never returned:
// only its members see it (household/getMyHousehold).
export const getHouseholdLinkInvite = query({
  args: { token: v.string() },
  handler: async (
    ctx,
    { token },
  ): Promise<{ state: HouseholdLinkState; inviterName?: string }> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    const { state, link } = await resolveHouseholdLink(
      ctx,
      token,
      memberId,
      Date.now(),
    );
    if (link === undefined) return { state };
    const inviterName = memberDisplayNameOf(await ctx.db.get(link.ownerId));
    return inviterName === undefined ? { state } : { state, inviterName };
  },
});

import type { HouseholdInviteLinkView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isLiveLink, recentHouseholdLinks } from "../social/inviteLinkRules";
import { membershipOf } from "./memberships";

// The household admin's open single-use invite links for their household (the Members tab's
// pending list): not revoked, consumed or expired. Only the current admin's links can be open: a
// link stops working once its owner is no longer the admin of the household it was minted for
// (social/householdLinkInvite), so reading the admin's own rows is the whole set. The token is
// never returned: the list only says when each link was made and when it expires, and offers
// Revoke. Empty for anyone who is not the household's admin.
export const listOpenInviteLinks = query({
  args: {},
  handler: async (ctx): Promise<HouseholdInviteLinkView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const membership = await membershipOf(ctx, me);
    if (membership?.role !== "admin") return [];
    const now = Date.now();
    return (await recentHouseholdLinks(ctx, me, now))
      .filter(
        (row) =>
          row.context?.householdId === membership.householdId &&
          isLiveLink(row, now),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        linkId: row._id as string,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt ?? row.createdAt,
      }));
  },
});

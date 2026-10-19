import { HouseholdError } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isLiveLink } from "../social/inviteLinkRules";
import { toConvexError } from "./errors";
import { membershipOf } from "./memberships";

// The household admin revokes one open single-use invite link to their household (a row in the
// Members tab's pending list). Unknown ids, network links and links that already stopped working
// (revoked, used, expired) are the same InviteNotFound; a link to another household, or a caller
// who is not this household's admin, is NotHouseholdAdmin. Revoking stamps revokedAt, after which
// the landing reads the link as invalid.
export const revokeInviteLink = mutation({
  args: { linkId: v.id("inviteLinks") },
  handler: async (ctx, { linkId }): Promise<void> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const link = await ctx.db.get(linkId);
    if (link === null || link.context === undefined || !isLiveLink(link, now)) {
      throw new ConvexError({
        code: "InviteNotFound",
        message: "No such household invite",
      });
    }
    const membership = await membershipOf(ctx, me);
    if (
      membership?.role !== "admin" ||
      membership.householdId !== link.context.householdId
    ) {
      throw toConvexError(HouseholdError.notHouseholdAdmin());
    }
    await ctx.db.patch(link._id, { revokedAt: now });
  },
});

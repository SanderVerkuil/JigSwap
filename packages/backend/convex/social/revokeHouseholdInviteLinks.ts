import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isLiveLink, recentHouseholdLinks } from "./inviteLinkRules";

// Revoke all of the acting member's OPEN household invite links ("Revoke open links"). Only the
// actor's own rows are read, and the network link is never touched. No admin check: a member who
// is no longer the admin may still withdraw links they minted.
export const revokeHouseholdInviteLinks = mutation({
  args: {},
  handler: async (ctx): Promise<{ revoked: number }> => {
    const ownerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const open = (await recentHouseholdLinks(ctx, ownerId, now)).filter((row) =>
      isLiveLink(row, now),
    );
    for (const row of open) {
      await ctx.db.patch(row._id, { revokedAt: now });
    }
    return { revoked: open.length };
  },
});

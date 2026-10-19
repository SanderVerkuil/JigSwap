"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { revokeInvitationBestEffort } from "./revokeClerkInvitation";

/**
 * The inviter withdraws one of their email invitations (spec E.1), or the household's admin one
 * to their household. Any other ref, or one that no longer exists, gets the same
 * EmailInviteUnavailable. The row and a pending in-app fallback go
 * at once; the Clerk invitation is revoked best-effort afterwards.
 */
export const revokeEmailInvite = action({
  args: { inviteRef: v.string() },
  handler: async (ctx, { inviteRef }): Promise<null> => {
    const { clerkInvitationId } = await ctx.runMutation(
      internal.invitations.emailInviteStore.takeForRevoke,
      { inviteRef },
    );
    if (clerkInvitationId !== null) {
      await revokeInvitationBestEffort(clerkInvitationId, "revoked");
    }
    return null;
  },
});

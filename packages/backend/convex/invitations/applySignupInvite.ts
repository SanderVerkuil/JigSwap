import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { offerConnection } from "../social/connectionOffers";
import { emailInviteKindValidator } from "./config";
import { inviteIntoEmailInviteHousehold } from "./fallbacks";

// Sign-up through an email invitation (spec E.1, "Sign-up"). Clerk copies the invitation's public
// metadata, { jsInvite: { kind, ref } }, onto the new user, and the svix-verified user.created
// webhook (http.ts) hands it here.

export type SignupInvite = { kind: "follow" | "household"; ref: string };

// Our refs are UUIDs; anything else in the slot is not ours.
const REF_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** The well-formed jsInvite in a Clerk user's public metadata, or null for anything else. */
export const signupInviteOf = (
  publicMetadata: unknown,
): SignupInvite | null => {
  if (typeof publicMetadata !== "object" || publicMetadata === null) {
    return null;
  }
  const invite = (publicMetadata as Record<string, unknown>)["jsInvite"];
  if (typeof invite !== "object" || invite === null) return null;
  const { kind, ref } = invite as Record<string, unknown>;
  if (kind !== "follow" && kind !== "household") return null;
  if (typeof ref !== "string" || !REF_PATTERN.test(ref)) return null;
  return { kind, ref };
};

/**
 * Apply the invitation the new member signed up through: a connection offer from the inviter
 * (follow; nothing is followed until they accept) or a pending household invite (household; only
 * while the inviter still admins that household). A missing, lapsed or mismatched row (revoked,
 * expired, purged) or the inviter's own account does nothing. The row is deleted once applied,
 * and the ref is cleared from the Clerk user's metadata either way (best-effort).
 */
export const applySignupInvite = internalMutation({
  args: {
    clerkUserId: v.string(),
    kind: emailInviteKindValidator,
    ref: v.string(),
  },
  handler: async (ctx, { clerkUserId, kind, ref }): Promise<void> => {
    const outcome = await (async (): Promise<string> => {
      const member = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId))
        .unique();
      if (member === null) return "no_member";
      await ctx.scheduler.runAfter(
        0,
        internal.invitations.clearInviteMetadata.clearSignupInviteMetadata,
        { clerkUserId },
      );

      const row = await ctx.db
        .query("emailInvites")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", ref))
        .unique();
      if (row === null || row.expiresAt <= Date.now()) return "no_invite";
      if (row.kind !== kind) return "kind_mismatch";
      if (row.inviterId === member._id) return "self";

      if (kind === "follow") {
        await offerConnection(ctx, {
          fromId: row.inviterId,
          toId: member._id,
          source: "emailInvite",
        });
      } else {
        await inviteIntoEmailInviteHousehold(ctx, {
          inviterId: row.inviterId,
          householdId: row.householdId,
          inviteeId: member._id,
        });
      }
      // The scheduled expireEmailInvite finds no row and does nothing.
      await ctx.db.delete(row._id);
      return "applied";
    })();
    logEvent({
      event: "invitations.applySignupInvite",
      outcome: "success",
      kind,
      invite_ref: ref,
      result: outcome,
    });
  },
});

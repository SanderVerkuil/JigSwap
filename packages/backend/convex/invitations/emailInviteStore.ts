import {
  HouseholdApplicationError,
  HouseholdError,
  inviterNameForEmail,
  normalizeInviteEmail,
} from "@jigswap/domain";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { convexHouseholdRepository } from "../household/adapters/convexHouseholdRepository";
import { toConvexError as toHouseholdConvexError } from "../household/errors";
import { membershipOf } from "../household/memberships";
import { memberDisplayNameOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { chargeClerkInviteBudget, enforceRateLimit } from "../lib/rateLimits";
import { toConvexError as toSocialConvexError } from "../social/errors";
import {
  EMAIL_INVITE_TTL_MS,
  emailInviteKindValidator,
  emailInviteUnavailable,
  SEND_LOG_WINDOW_MS,
} from "./config";
import { applyExistingMemberFallback, withdrawFallback } from "./fallbacks";

// The transactional steps of the email-invite actions (sendEmailInvite, revokeEmailInvite), plus
// the scheduled expiry and send-log cleanup. Internal only: the actions are the public surface.

/**
 * Steps 1–4 of sendEmailInvite, in ONE mutation that commits before any Clerk or email work, so
 * the rate-limit count stands whatever happens next: the inviter gate (member; household admin
 * for a household invite, refused with the inviter-only household error), the address check
 * (InvalidEmail), the per-inviter limit (RateLimited), and the local ref row with its expiry.
 * Returns what the action needs; the normalised address is returned, never stored.
 */
export const beginEmailInvite = internalMutation({
  args: { kind: emailInviteKindValidator, email: v.string() },
  handler: async (ctx, { kind, email }) => {
    const actorId = await requireMember(ctx);
    const inviterId = actorId as unknown as Id<"users">;

    let householdId: string | undefined;
    if (kind === "household") {
      const household =
        await convexHouseholdRepository(ctx).findByMember(actorId);
      if (!household) {
        throw toHouseholdConvexError(
          HouseholdApplicationError.notInHousehold(),
        );
      }
      if (!household.isAdmin(actorId)) {
        throw toHouseholdConvexError(HouseholdError.notHouseholdAdmin());
      }
      householdId = household.id as string;
    }

    const normalized = normalizeInviteEmail(email);
    if (normalized.isErr) throw toSocialConvexError(normalized.error);

    await enforceRateLimit(ctx, "emailInvite", inviterId);

    const now = Date.now();
    const ref = crypto.randomUUID();
    const expiresAt = now + EMAIL_INVITE_TTL_MS;
    await ctx.db.insert("emailInvites", {
      aggregateId: ref,
      kind,
      inviterId,
      ...(householdId !== undefined && { householdId }),
      createdAt: now,
      expiresAt,
    });
    await ctx.scheduler.runAt(
      expiresAt,
      internal.invitations.emailInviteStore.expireEmailInvite,
      { inviteRef: ref },
    );

    const inviter = await ctx.db.get(inviterId);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) => q.eq("memberId", inviterId))
      .unique();
    return {
      ref,
      inviterId,
      email: normalized.value,
      locale:
        inviter?.preferredLanguage === "nl" ? ("nl" as const) : ("en" as const),
      inviterName: inviterNameForEmail(memberDisplayNameOf(inviter, profile)),
    };
  },
});

/**
 * Steps 5–6: whether the address already had an invitation email in the last 30 days (by its
 * HMAC), and whether it belongs to a member (users.by_email, the verified-email mirror).
 */
export const inspectAddress = internalQuery({
  args: { email: v.string(), emailHmac: v.string() },
  handler: async (
    ctx,
    { email, emailHmac },
  ): Promise<{ capped: boolean; memberId: Id<"users"> | null }> => {
    const recent = await ctx.db
      .query("emailInviteSendLog")
      .withIndex("by_hmac", (q) =>
        q
          .eq("emailHmac", emailHmac)
          .gt("sentAt", Date.now() - SEND_LOG_WINDOW_MS),
      )
      .first();
    const member = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    return { capped: recent !== null, memberId: member?._id ?? null };
  },
});

/** Step 6, existing member: the kind's in-app fallback instead of an email. */
export const applyExistingMember = internalMutation({
  args: { inviteRef: v.string(), memberId: v.id("users") },
  handler: async (ctx, { inviteRef, memberId }): Promise<void> => {
    const row = await ctx.db
      .query("emailInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteRef))
      .unique();
    if (row === null) return;
    const fallback = await applyExistingMemberFallback(ctx, {
      kind: row.kind,
      inviterId: row.inviterId,
      ...(row.householdId !== undefined && { householdId: row.householdId }),
      memberId,
      ref: row.aggregateId,
    });
    if (fallback !== undefined) await ctx.db.patch(row._id, { fallback });
  },
});

/** Step 7, first: one creation off the deployment-wide Clerk budget, or false when it is spent. */
export const chargeClerkInvite = internalMutation({
  args: {},
  handler: async (ctx): Promise<boolean> => chargeClerkInviteBudget(ctx),
});

/**
 * Step 7: remember the Clerk invitation on the row. False when the row is gone (revoked, purged)
 * in the meantime: the caller then revokes the invitation it just created.
 */
export const recordClerkInvitation = internalMutation({
  args: { inviteRef: v.string(), clerkInvitationId: v.string() },
  handler: async (ctx, { inviteRef, clerkInvitationId }): Promise<boolean> => {
    const row = await ctx.db
      .query("emailInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteRef))
      .unique();
    if (row === null) return false;
    await ctx.db.patch(row._id, { clerkInvitationId });
    return true;
  },
});

/** Step 8: log the sent email against the address HMAC, deleted again after the 30-day window. */
export const recordSend = internalMutation({
  args: { emailHmac: v.string() },
  handler: async (ctx, { emailHmac }): Promise<void> => {
    const sentAt = Date.now();
    const id = await ctx.db.insert("emailInviteSendLog", { emailHmac, sentAt });
    await ctx.scheduler.runAt(
      sentAt + SEND_LOG_WINDOW_MS,
      internal.invitations.emailInviteStore.deleteSendLogEntry,
      { id },
    );
  },
});

// Scheduled at sentAt + 30 days. A no-op for a row still inside its window (or already gone).
export const deleteSendLogEntry = internalMutation({
  args: { id: v.id("emailInviteSendLog") },
  handler: async (ctx, { id }): Promise<void> => {
    const row = await ctx.db.get(id);
    if (row === null || row.sentAt + SEND_LOG_WINDOW_MS > Date.now()) return;
    await ctx.db.delete(id);
  },
});

/**
 * revokeEmailInvite's transactional step: the inviter may revoke, and so may the current admin of
 * the household a household invitation is for; any other ref (unknown, someone else's, already
 * gone) is the same generic EmailInviteUnavailable. Withdraws a pending
 * in-app fallback, deletes the row, and returns the Clerk invitation still to revoke.
 */
export const takeForRevoke = internalMutation({
  args: { inviteRef: v.string() },
  handler: async (
    ctx,
    { inviteRef },
  ): Promise<{ clerkInvitationId: string | null }> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const row = await ctx.db
      .query("emailInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteRef))
      .unique();
    if (row === null) throw emailInviteUnavailable();
    // The sender, or the current admin of the household a household invitation is for (who sees
    // it in their pending list, also after a handover). Anyone else: the same Unavailable.
    if (row.inviterId !== me) {
      const membership =
        row.kind === "household" ? await membershipOf(ctx, me) : null;
      if (
        membership === null ||
        membership.role !== "admin" ||
        membership.householdId !== row.householdId
      ) {
        throw emailInviteUnavailable();
      }
    }
    await withdrawFallback(ctx, row);
    await ctx.db.delete(row._id);
    return { clerkInvitationId: row.clerkInvitationId ?? null };
  },
});

/**
 * Scheduled at the row's expiresAt: withdraw a still-pending in-app fallback, delete the row,
 * and revoke and delete its Clerk invitation (best-effort, in a scheduled action). A no-op once
 * the row is gone, or for a call before its expiry.
 */
export const expireEmailInvite = internalMutation({
  args: { inviteRef: v.string() },
  handler: async (ctx, { inviteRef }): Promise<void> => {
    const row = await ctx.db
      .query("emailInvites")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", inviteRef))
      .unique();
    if (row === null || row.expiresAt > Date.now()) return;
    await withdrawFallback(ctx, row);
    await ctx.db.delete(row._id);
    if (row.clerkInvitationId !== undefined) {
      await ctx.scheduler.runAfter(
        0,
        internal.invitations.revokeClerkInvitation.revokeClerkInvitation,
        { clerkInvitationId: row.clerkInvitationId, reason: "expired" },
      );
    }
  },
});

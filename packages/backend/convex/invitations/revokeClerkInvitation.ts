"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent, type WideEvent } from "../lib/logEvent";
import { invitationErrorCode } from "./adapters/clerkInvitationGateway";
import { makeInvitationGatewayFromEnv } from "./adapters/invitationGateway";

const reasonValidator = v.union(
  v.literal("revoked"),
  v.literal("expired"),
  v.literal("purged"),
);
type RevokeReason = typeof reasonValidator.type;

/**
 * Revoke one Clerk invitation, best-effort: a failure (already accepted or revoked, Clerk down,
 * no CLERK_SECRET_KEY) is logged and dropped. The local row is already gone or being dropped, and
 * a revoke only blocks the link (spec E.0), so nothing depends on it succeeding.
 */
export const revokeInvitationBestEffort = async (
  clerkInvitationId: string,
  reason: RevokeReason,
): Promise<void> => {
  const event: WideEvent = {
    event: "invitations.revokeClerkInvitation",
    outcome: "success",
    reason,
  };
  try {
    if (!process.env["CLERK_SECRET_KEY"]) {
      event.skipped = true;
      event.skip_reason = "unconfigured";
      return;
    }
    await makeInvitationGatewayFromEnv().revoke(clerkInvitationId);
  } catch (error) {
    event.outcome = "error";
    event.error = { code: invitationErrorCode(error) };
  } finally {
    await ingestToAxiom(logEvent(event));
  }
};

// Scheduled by expireEmailInvite and the account-deletion purge (conversation/purgeMemberMessagingData).
export const revokeClerkInvitation = internalAction({
  args: { clerkInvitationId: v.string(), reason: reasonValidator },
  handler: async (_ctx, { clerkInvitationId, reason }): Promise<void> => {
    await revokeInvitationBestEffort(clerkInvitationId, reason);
  },
});

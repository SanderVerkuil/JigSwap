"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent, type WideEvent } from "../lib/logEvent";
import { invitationErrorCode } from "./adapters/clerkInvitationGateway";
import { makeInvitationGatewayFromEnv } from "./adapters/invitationGateway";

// Scheduled by applySignupInvite: remove `jsInvite` from the new member's Clerk public metadata,
// where the invitation put it, so our ref doesn't linger. Best-effort: a failure is logged and
// dropped (the ref points at a row that is already gone).
export const clearSignupInviteMetadata = internalAction({
  args: { clerkUserId: v.string() },
  handler: async (_ctx, { clerkUserId }): Promise<void> => {
    const event: WideEvent = {
      event: "invitations.clearSignupInviteMetadata",
      outcome: "success",
    };
    try {
      if (!process.env["CLERK_SECRET_KEY"]) {
        event.skipped = true;
        event.skip_reason = "unconfigured";
        return;
      }
      await makeInvitationGatewayFromEnv().clearInviteMetadata(clerkUserId);
    } catch (error) {
      event.outcome = "error";
      event.error = { code: invitationErrorCode(error) };
    } finally {
      await ingestToAxiom(logEvent(event));
    }
  },
});

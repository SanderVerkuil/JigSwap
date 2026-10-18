"use node";

import { renderInviteEmail } from "@jigswap/email";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action, type ActionCtx } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent, type WideEvent } from "../lib/logEvent";
import { makeEmailSenderFromEnv } from "../notifications/adapters/email";
import { invitationErrorCode } from "./adapters/clerkInvitationGateway";
import {
  makeInvitationGatewayFromEnv,
  retireInvitation,
  type CreateInvitationResult,
  type InvitationGateway,
} from "./adapters/invitationGateway";
import {
  EMAIL_INVITE_TTL_DAYS,
  emailHmacOf,
  emailInviteKindValidator,
  emailInvitesEnabled,
  emailInvitesUnavailable,
  EXISTING_MEMBER_DELAY_MS,
} from "./config";

type Begun = {
  ref: string;
  email: string;
  locale: "en" | "nl";
  inviterName?: string;
};
type Kind = typeof emailInviteKindValidator.type;

const errorCodeOf = (error: unknown): string =>
  error instanceof ConvexError
    ? typeof error.data === "string"
      ? error.data
      : String((error.data as { code?: unknown }).code ?? "ConvexError")
    : error instanceof Error
      ? error.name
      : "unknown";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Revoke and delete an invitation we created but won't use; failures go on the wide event.
const retireQuietly = async (
  gateway: InvitationGateway,
  id: string,
  event: WideEvent,
): Promise<void> => {
  const errors = await retireInvitation(gateway, id);
  if (errors.revoke !== undefined) event.revoke_error = errors.revoke;
  if (errors.delete !== undefined) event.delete_error = errors.delete;
};

// Steps 5–8 of the spec, after the gate, the rate limit and the ref row have committed. Returns
// the internal reason code for the wide event. Every path ends in the same answer to the inviter,
// so nothing here throws for a reason tied to the address.
const deliver = async (
  ctx: ActionCtx,
  kind: Kind,
  begun: Begun,
  event: WideEvent,
): Promise<string> => {
  const emailHmac = await emailHmacOf(
    process.env["INVITE_EMAIL_HMAC_KEY"] as string,
    begun.email,
  );
  const address = await ctx.runQuery(
    internal.invitations.emailInviteStore.inspectAddress,
    { email: begun.email, emailHmac },
  );
  if (address.capped) return "address_capped";

  if (address.memberId !== null) {
    await ctx.runMutation(
      internal.invitations.emailInviteStore.applyExistingMember,
      { inviteRef: begun.ref, memberId: address.memberId },
    );
    const { min, max } = EXISTING_MEMBER_DELAY_MS;
    await pause(min + Math.random() * (max - min));
    return "existing_member";
  }

  // Without a mail provider there is nothing to send, so don't create a Clerk invitation either.
  if (!process.env["AHASEND_API_KEY"] || !process.env["AHASEND_ACCOUNT_ID"]) {
    return "email_unconfigured";
  }

  const gateway = makeInvitationGatewayFromEnv();
  const baseUrl = process.env["EMAIL_BASE_URL"] ?? "https://jigswap.site";
  let created: CreateInvitationResult;
  try {
    created = await gateway.create({
      email: begun.email,
      // TO VERIFY (spec E.0, 2): Clerk's <SignUp /> consumes the ticket on this route.
      redirectUrl: `${baseUrl}/sign-up`,
      expiresInDays: EMAIL_INVITE_TTL_DAYS,
      publicMetadata: { jsInvite: { kind, ref: begun.ref } },
    });
  } catch (error) {
    event.outcome = "error";
    event.error = { code: invitationErrorCode(error) };
    return "clerk_error";
  }
  if (created.kind === "exists") return "clerk_exists";

  const kept = await ctx.runMutation(
    internal.invitations.emailInviteStore.recordClerkInvitation,
    { inviteRef: begun.ref, clerkInvitationId: created.id },
  );
  if (!kept) {
    await retireQuietly(gateway, created.id, event);
    return "withdrawn";
  }
  if (created.kind === "no_url") {
    await retireQuietly(gateway, created.id, event);
    // Its own event, so the TO VERIFY outcome is easy to alert on.
    logEvent({ event: "emailInvite.no_url", outcome: "error", kind });
    return "no_url";
  }

  const rendered = await renderInviteEmail({
    kind,
    locale: begun.locale,
    ...(begun.inviterName !== undefined && { inviterName: begun.inviterName }),
    ctaUrl: created.url,
  });
  try {
    await makeEmailSenderFromEnv().send({
      to: begun.email,
      toName: "",
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fromName: rendered.fromName,
      idempotencyKey: `emailInvite:${begun.ref}`,
    });
  } catch (error) {
    // Only the error's name: a provider message may quote the address.
    event.outcome = "error";
    event.error = {
      code: error instanceof Error ? error.name : "unknown",
    };
    await retireQuietly(gateway, created.id, event);
    return "send_failed";
  }
  await ctx.runMutation(internal.invitations.emailInviteStore.recordSend, {
    emailHmac,
  });
  return "emailed";
};

/**
 * Invite someone by email (#222, spec E.1): to follow each other, or (household admin only) to
 * join the inviter's household. The answer is `{ status: "sent" }` for every well-formed address
 * within the limits, whether or not it belongs to a member, whether or not an email went out: an
 * existing member gets the in-app path instead, an address capped in the last 30 days gets
 * nothing. Refusals are about the inviter or the input only: Unauthenticated, the household
 * errors (NotInHousehold, NotHouseholdAdmin), InvalidEmail, RateLimited (with retryAfterMs) and
 * EmailInvitesUnavailable when the feature is switched off. The address is never stored or
 * logged.
 */
export const sendEmailInvite = action({
  args: { kind: emailInviteKindValidator, email: v.string() },
  handler: async (ctx, { kind, email }): Promise<{ status: "sent" }> => {
    const startedAt = Date.now();
    const event: WideEvent = {
      event: "invitations.sendEmailInvite",
      outcome: "success",
      request_id: crypto.randomUUID(),
      kind,
    };
    try {
      if ((await ctx.auth.getUserIdentity()) === null) {
        throw new ConvexError("Unauthenticated");
      }
      if (!emailInvitesEnabled()) throw emailInvitesUnavailable();
      const begun: Begun = await ctx.runMutation(
        internal.invitations.emailInviteStore.beginEmailInvite,
        { kind, email },
      );
      event.invite_ref = begun.ref;
      event.reason = await deliver(ctx, kind, begun, event);
      return { status: "sent" };
    } catch (error) {
      event.outcome = "error";
      event.reason = "refused";
      event.error = { code: errorCodeOf(error) };
      throw error;
    } finally {
      event.duration_ms = Date.now() - startedAt;
      await ingestToAxiom(logEvent(event));
    }
  },
});

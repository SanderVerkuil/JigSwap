import { makeUpdateNotificationPreference, toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { httpAction, internalMutation } from "../_generated/server";
import { logEvent } from "../lib/logEvent";
import { convexNotificationPreferenceRepository } from "./adapters/convexNotificationPreferenceRepository";
import { notificationPreferenceIdGenerator } from "./adapters/idGenerators";
import { systemClock } from "./adapters/systemClock";
import { notificationTypeValidator } from "./preferenceValidators";
import {
  emailUnsubscribeSecretOf,
  verifyEmailUnsubscribeToken,
} from "./unsubscribeToken";

// The one-click unsubscribe endpoint behind every notification email's List-Unsubscribe header
// (SEC-84, RFC 8058), routed at /email/unsubscribe in http.ts. The signed token in the query
// string is the only authority: it names one member and one notification type, and a POST switches
// off exactly that type's email for that member, the same change as the switch on
// /notifications/preferences. A GET never changes anything: link scanners and mail clients that
// prefetch links must not unsubscribe anyone, so it only redirects to the preferences page.

// PreferenceChanged is a leaf event (no downstream subscriber); drop it, as the preferences page does.
const noopEvents = { async publish(): Promise<void> {} };

/** Switch off one type's email for a member. A no-op for an unknown or deactivated account. */
export const unsubscribeEmail = internalMutation({
  args: { userId: v.string(), type: notificationTypeValidator },
  handler: async (ctx, args) => {
    const userId = ctx.db.normalizeId("users", args.userId);
    if (userId === null) return;
    const user = await ctx.db.get(userId);
    if (!user?.isActive) return;
    const updatePreference = makeUpdateNotificationPreference({
      preferences: convexNotificationPreferenceRepository(ctx),
      preferenceIds: notificationPreferenceIdGenerator,
      events: noopEvents,
      clock: systemClock,
    });
    await updatePreference({
      memberId: toMemberId(userId),
      type: args.type,
      channel: "email",
      enabled: false,
    });
  },
});

const textResponse = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

// RFC 8058 one-click: the mail provider POSTs `List-Unsubscribe=One-Click` to the URL from the
// header, with no cookies or credentials. Answered directly (never with a redirect, which the RFC
// forbids). Whatever the account's state, a valid token answers 200, so the response says nothing
// about the member.
export const unsubscribeEmailOneClick = httpAction(async (ctx, request) => {
  const secret = emailUnsubscribeSecretOf(process.env);
  if (secret === null) {
    logEvent({
      event: "notifications.emailUnsubscribe",
      outcome: "error",
      error: { code: "Unconfigured" },
    });
    return textResponse(503, "Unsubscribe is not available.");
  }
  const token = new URL(request.url).searchParams.get("token");
  const target =
    token === null ? null : await verifyEmailUnsubscribeToken(secret, token);
  if (target === null) {
    logEvent({
      event: "notifications.emailUnsubscribe",
      outcome: "success",
      refused: true,
      refuse_reason: "invalid_token",
    });
    return textResponse(400, "This unsubscribe link is not valid.");
  }
  await ctx.runMutation(
    internal.notifications.unsubscribe.unsubscribeEmail,
    target,
  );
  logEvent({
    event: "notifications.emailUnsubscribe",
    outcome: "success",
    type: target.type,
  });
  return textResponse(200, "You will no longer get these emails.");
});

// A GET of the same URL (a link scanner, or a mail client that opens the link in a browser) lands
// on the preferences page and changes nothing.
export const unsubscribeEmailLanding = httpAction(async () => {
  const baseUrl = process.env["EMAIL_BASE_URL"] ?? "https://jigswap.site";
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/notifications/preferences", baseUrl).toString(),
    },
  });
});

"use node";
import { v } from "convex/values";
import webpush from "web-push";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent, type WideEvent } from "../lib/logEvent";
import {
  isGoneStatus,
  toWebPushPayload,
  type VapidConfig,
  vapidConfigFromEnv,
  type WebPushSender,
} from "./adapters/webPush";

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// The REAL web-push adapter: signs the VAPID JWT and encrypts the payload via the `web-push` lib
// (pure JS + Node crypto, so it bundles in the Convex Node runtime — unlike sharp's native binary).
// Never throws: a send failure becomes a result, with `gone` set for the 404/410 statuses that mean
// the subscription is permanently dead and should be pruned.
const makeRealSender = (vapid: VapidConfig): WebPushSender => {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    async send(sub, payload) {
      try {
        const res = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
        return { ok: true, gone: false, statusCode: res.statusCode ?? 201 };
      } catch (e) {
        const statusCode =
          typeof (e as { statusCode?: unknown }).statusCode === "number"
            ? (e as { statusCode: number }).statusCode
            : null;
        return {
          ok: false,
          gone: statusCode != null && isGoneStatus(statusCode),
          statusCode,
          error: errMsg(e),
        };
      }
    },
  };
};

// Out-of-band push delivery for ONE recipient, scheduled (runAfter 0) by the push channel after the
// originating mutation commits. Fans the notification out to every active subscription, prunes the
// dead ones, and emits ONE wide event so a missing push is diagnosable. FAIL-OPEN: with VAPID unset
// it logs and drops (the in-app row already exists), so push is disabled-by-default.
export const send = internalAction({
  args: {
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    relatedId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const event: WideEvent = {
      event: "notifications.webPush",
      outcome: "success",
      request_id: crypto.randomUUID(),
      user_id: args.userId as unknown as string,
      type: args.type,
    };
    const flush = async () => {
      event.duration_ms = Date.now() - startedAt;
      await ingestToAxiom(logEvent(event));
    };

    try {
      const vapid = vapidConfigFromEnv();
      event.configured = vapid != null;

      const subs = await ctx.runQuery(
        internal.notifications.pushSubscriptions.listSubscriptionsForUser,
        { userId: args.userId },
      );
      event.subscription_count = subs.length;

      if (!vapid || subs.length === 0) {
        event.skipped = true;
        event.skip_reason = !vapid ? "unconfigured" : "no_subscriptions";
        await flush();
        return;
      }

      const sender = makeRealSender(vapid);
      const payload = toWebPushPayload(args);

      let sent = 0;
      let pruned = 0;
      let failed = 0;
      for (const sub of subs) {
        const result = await sender.send(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
        );
        if (result.ok) {
          sent += 1;
        } else if (result.gone) {
          await ctx.runMutation(
            internal.notifications.pushSubscriptions.pruneSubscription,
            { id: sub._id },
          );
          pruned += 1;
        } else {
          failed += 1;
        }
      }
      event.sent = sent;
      event.pruned = pruned;
      event.failed = failed;
      if (sent === 0 && failed > 0) event.outcome = "error";
    } catch (error) {
      event.outcome = "error";
      event.error = { code: "Unexpected", detail: errMsg(error) };
    } finally {
      await flush();
    }
  },
});

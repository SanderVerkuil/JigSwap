"use node";
import { type EmailLocale, isEmailType, renderEmail } from "@jigswap/email";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent, type WideEvent } from "../lib/logEvent";
import { makeEmailSenderFromEnv } from "./adapters/email";

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

// Out-of-band email delivery for ONE notification, scheduled (runAfter 0) by the email channel
// after the originating mutation commits. Renders the localized react-email template here (the
// recipient's language travels with the args) and hands the rendered message to the configured
// EmailSender (AhaSend, or the no-op when unconfigured). FAIL-OPEN: any failure is logged as a
// wide event and dropped — the in-app row already exists, and Convex-scheduled actions run at
// most once (no retry), which the spec accepts for notification email.
export const send = internalAction({
  args: {
    to: v.string(),
    toName: v.string(),
    type: v.string(),
    params: v.record(v.string(), v.string()),
    locale: v.string(),
    relatedId: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (_ctx, args) => {
    const startedAt = Date.now();
    const event: WideEvent = {
      event: "notifications.email",
      outcome: "success",
      request_id: crypto.randomUUID(),
      type: args.type,
    };
    const flush = async () => {
      event.duration_ms = Date.now() - startedAt;
      await ingestToAxiom(logEvent(event));
    };

    try {
      if (!isEmailType(args.type)) {
        // Defense in depth: the domain already gates on EMAIL_ELIGIBLE_TYPES.
        event.skipped = true;
        event.skip_reason = "ineligible_type";
        return;
      }
      const locale: EmailLocale = args.locale === "nl" ? "nl" : "en";
      event.locale = locale;

      const configured = !!(
        process.env["AHASEND_API_KEY"] && process.env["AHASEND_ACCOUNT_ID"]
      );
      event.configured = configured;
      if (!configured) {
        // Fail-open by design, but make the drop diagnosable: without this, a prod
        // misconfiguration would log 100% success while delivering nothing.
        event.skipped = true;
        event.skip_reason = "unconfigured";
        return;
      }

      const baseUrl = process.env["EMAIL_BASE_URL"] ?? "https://jigswap.site";
      const rendered = await renderEmail({
        type: args.type,
        params: args.params,
        locale,
        baseUrl,
        relatedId: args.relatedId,
      });
      await makeEmailSenderFromEnv().send({
        to: args.to,
        toName: args.toName,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        fromName: rendered.fromName,
        idempotencyKey: args.idempotencyKey,
      });
    } catch (error) {
      event.outcome = "error";
      event.error = { code: "Unexpected", detail: errMsg(error) };
    } finally {
      await flush();
    }
  },
});

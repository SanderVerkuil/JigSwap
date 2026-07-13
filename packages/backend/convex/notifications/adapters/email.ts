import { ahaSendEmailSender } from "./ahasendEmailSender";

// Pluggable email-sender port. The message arrives fully RENDERED (subject/html/text via
// @jigswap/email) so adapters stay render-agnostic. The configured adapter is AhaSend
// (EU provider, jigswap.site domain); with the env unset this is a fail-open no-op so dev and
// preview deployments drop email harmlessly while the in-app feed keeps working.

export interface EmailMessage {
  readonly to: string;
  readonly toName: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  // Stable per-notification key (the Notification aggregateId): a replayed send is deduplicated
  // by the provider instead of double-delivering.
  readonly idempotencyKey: string;
}

// Outbound port. An adapter MAY throw on failure — the sendEmail action is the single caller and
// catches everything into a wide event (fail-open: a dropped email never breaks anything else).
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

// The default: no provider configured. Logs and drops, so opting a member into the email channel is
// harmless until the AhaSend env vars are set on the deployment.
export const noopEmailSender = (reason: string): EmailSender => ({
  async send(message) {
    console.warn(
      `email disabled (${reason}); dropping "${message.subject}" email to ${message.to}.`,
    );
  },
});

// Select the email adapter from env (read lazily per repo convention — never at module scope).
// AHASEND_SANDBOX=true keeps real API calls but suppresses delivery (AhaSend accepts and discards).
export const makeEmailSenderFromEnv = (
  env: Record<string, string | undefined> = process.env,
): EmailSender => {
  const apiKey = env["AHASEND_API_KEY"];
  const accountId = env["AHASEND_ACCOUNT_ID"];
  const from = env["EMAIL_FROM"];
  if (!apiKey || !accountId || !from) {
    return noopEmailSender(
      "AhaSend not configured: set AHASEND_API_KEY, AHASEND_ACCOUNT_ID, EMAIL_FROM",
    );
  }
  return ahaSendEmailSender({
    apiKey,
    accountId,
    from,
    fromName: env["EMAIL_FROM_NAME"] ?? "JigSwap",
    sandbox: env["AHASEND_SANDBOX"] === "true",
  });
};

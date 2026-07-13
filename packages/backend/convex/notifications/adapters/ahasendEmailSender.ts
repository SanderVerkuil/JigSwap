import type { EmailMessage, EmailSender } from "./email";

export interface AhaSendConfig {
  readonly apiKey: string;
  readonly accountId: string;
  readonly from: string;
  readonly fromName: string;
  readonly sandbox: boolean;
  // Injectable for tests; defaults to the runtime fetch.
  readonly fetchImpl?: typeof fetch;
}

// ★ Header-injection guard: subjects and display names are interpolated from member-provided
// values, so any CR/LF is collapsed to a space before the value goes anywhere near a mail
// header. AhaSend builds MIME server-side from JSON today, but a future adapter might not —
// sanitize at the choke point.
const stripCrlf = (value: string): string => value.replace(/[\r\n]+/g, " ");

// The REAL email adapter: one fetch to AhaSend's v2 create-message endpoint
// (https://ahasend.com/docs/api-reference/messages/create-message). The Idempotency-Key header
// makes a replayed send return the cached response instead of double-delivering. `sandbox: true`
// (AHASEND_SANDBOX) makes AhaSend accept-but-not-deliver — used for live verification. Throws on
// any non-2xx; the sendEmail action catches, logs a wide event, and drops (fail-open).
export const ahaSendEmailSender = (cfg: AhaSendConfig): EmailSender => ({
  async send(message: EmailMessage): Promise<void> {
    const doFetch = cfg.fetchImpl ?? fetch;
    const res = await doFetch(
      `https://api.ahasend.com/v2/accounts/${cfg.accountId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: {
            email: cfg.from,
            name: stripCrlf(message.fromName ?? cfg.fromName),
          },
          recipients: [{ email: message.to, name: stripCrlf(message.toName) }],
          subject: stripCrlf(message.subject),
          html_content: message.html,
          text_content: message.text,
          ...(cfg.sandbox ? { sandbox: true } : {}),
        }),
      },
    );
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      throw new Error(`AhaSend ${res.status}: ${detail}`);
    }
  },
});

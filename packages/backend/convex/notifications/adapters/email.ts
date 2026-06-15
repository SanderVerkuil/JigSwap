// Pluggable email-sender port + a no-op default. Knock previously delivered the email channel; it
// has been removed, so email currently has NO real provider. This seam keeps the channel wired and
// fail-open (the in-app feed is unaffected) so dropping in a real provider later (Resend, SES,
// Postmark, …) is a single adapter swap behind `makeEmailSenderFromEnv` — no domain or channel
// changes. A real adapter can call its HTTP API with `fetch` (no Node runtime required).

export interface EmailMessage {
  readonly to: string;
  readonly toName: string;
  readonly subject: string;
  readonly body: string;
  readonly type: string;
  readonly relatedId?: string;
}

// Outbound port. An adapter sends ONE email and must never throw for a benign/transient failure —
// it logs and returns, so a flaky provider never breaks the originating mutation.
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

// The default: no provider configured. Logs and drops, so opting a member into the email channel is
// harmless until a provider is wired in.
export const noopEmailSender = (reason: string): EmailSender => ({
  async send(message) {
    console.warn(
      `email disabled (${reason}); dropping "${message.type}" email to ${message.to}.`,
    );
  },
});

// Select the email adapter from env. Today this is always the no-op (Knock removed, no replacement
// chosen yet). When a provider is added, branch on e.g. `EMAIL_PROVIDER` here and return its adapter.
export const makeEmailSenderFromEnv = (
  _env: Record<string, string | undefined> = process.env,
): EmailSender => noopEmailSender("no email provider configured");

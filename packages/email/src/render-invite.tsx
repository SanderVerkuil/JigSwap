import { render } from "@react-email/render";
import type { EmailLocale } from "./copy";
import {
  INVITE_COPY,
  INVITE_FOOTER,
  INVITER_FALLBACK,
  type InviteKind,
} from "./invite-copy";
import { InviteEmail } from "./invite-email";
import type { RenderedEmail } from "./render";

export interface RenderInviteEmailInput {
  readonly kind: InviteKind;
  readonly locale: EmailLocale;
  /**
   * The inviter's display name, ALREADY sanitised for email (domain inviterNameForEmail: no line
   * breaks, length-capped). Absent: the localized generic label.
   */
  readonly inviterName?: string;
  /** The invitation link (the sign-in provider's ticket URL). */
  readonly ctaUrl: string;
}

// A replacer function, so a name like "$'" is inserted literally, never as a replacement pattern.
const withName = (template: string, name: string): string =>
  template.replaceAll("{inviterName}", () => name);

// Render the invitation email. React escapes the name in the HTML; the subject carries no member
// text other than it. The From name is always the brand: the inviter is named inside, not in a
// header the recipient's mail client shows as the sender.
export const renderInviteEmail = async (
  input: RenderInviteEmailInput,
): Promise<RenderedEmail> => {
  const copy = INVITE_COPY[input.kind][input.locale];
  const name = input.inviterName || INVITER_FALLBACK[input.locale];
  const element = (
    <InviteEmail
      heading={withName(copy.heading, name)}
      body={withName(copy.body, name)}
      ctaLabel={copy.cta}
      ctaUrl={input.ctaUrl}
      footerText={withName(INVITE_FOOTER[input.locale], name)}
    />
  );
  return {
    subject: withName(copy.subject, name),
    html: await render(element),
    text: await render(element, { plainText: true }),
    fromName: "JigSwap",
  };
};

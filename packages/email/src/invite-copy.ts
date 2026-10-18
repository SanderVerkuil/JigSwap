import type { EmailLocale } from "./copy";

// Localized copy for the invitation email (#222): one email to someone who is not on JigSwap yet,
// sent on behalf of a member. It is not a notification type: the recipient has no account, no
// locale and no preferences, so it renders in the INVITER's language and has its own footer.
// The only member text in it is {inviterName}; every sentence starts with it, so the generic
// label reads correctly when the inviter has no displayable name. Hand-maintained like copy.ts.

export const INVITE_KINDS = ["follow", "household"] as const;
export type InviteKind = (typeof INVITE_KINDS)[number];

export interface InviteCopy {
  readonly subject: string;
  readonly heading: string;
  readonly body: string;
  readonly cta: string;
}

/** The inviter label when the member has no displayable name. */
export const INVITER_FALLBACK: Record<EmailLocale, string> = {
  en: "A JigSwap member",
  nl: "Een JigSwap-lid",
};

export const INVITE_COPY: Record<
  InviteKind,
  Record<EmailLocale, InviteCopy>
> = {
  follow: {
    en: {
      subject: "{inviterName} invited you to JigSwap",
      heading: "{inviterName} invited you to JigSwap",
      body: "{inviterName} invited you to JigSwap to follow each other. JigSwap is where puzzlers share, swap and lend their jigsaw puzzles. Once you have joined, you choose whether you follow each other.",
      cta: "Join JigSwap",
    },
    nl: {
      subject: "{inviterName} nodigt je uit voor JigSwap",
      heading: "{inviterName} nodigt je uit voor JigSwap",
      body: "{inviterName} nodigt je uit voor JigSwap om elkaar te volgen. Op JigSwap delen, ruilen en lenen puzzelaars hun legpuzzels. Zodra je lid bent, kies je zelf of jullie elkaar volgen.",
      cta: "Word lid van JigSwap",
    },
  },
  household: {
    en: {
      subject: "{inviterName} invited you to their household on JigSwap",
      heading: "{inviterName} invited you to their household",
      body: "{inviterName} invited you to JigSwap to join their household. A household pools its members' jigsaw puzzles in one shared library. Once you have joined JigSwap, you choose whether you accept.",
      cta: "Join JigSwap",
    },
    nl: {
      subject: "{inviterName} nodigt je uit voor hun huishouden op JigSwap",
      heading: "{inviterName} nodigt je uit voor hun huishouden",
      body: "{inviterName} nodigt je uit voor JigSwap om lid te worden van hun huishouden. Een huishouden bundelt de legpuzzels van zijn leden in één gedeelde verzameling. Zodra je lid bent van JigSwap, kies je zelf of je de uitnodiging accepteert.",
      cta: "Word lid van JigSwap",
    },
  },
};

/** Who sent it, and what happens if it is ignored: nothing, and no copy of the address is kept. */
export const INVITE_FOOTER: Record<EmailLocale, string> = {
  en: "{inviterName} invited you with this email address. If you ignore this email, nothing more happens: JigSwap keeps no copy of your address, and the invitation expires after 14 days.",
  nl: "{inviterName} heeft je met dit e-mailadres uitgenodigd. Negeer je deze e-mail, dan gebeurt er verder niets: JigSwap bewaart je adres niet, en de uitnodiging verloopt na 14 dagen.",
};

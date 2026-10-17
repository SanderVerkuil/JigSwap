import { ConvexError } from "convex/values";

// Pure helpers behind InviteShareActions (decision 2: invites are shared from the member's own
// device). Every URL leaves the recipient blank, so the member picks who gets it in their own
// app and JigSwap never sees or stores an address.

// The landing for both link kinds: the stable member-id URL (rename-proof, like the QR) with the
// opaque token. The landing redirects to the canonical slug/username URL, keeping ?invite.
export const inviteLandingUrl = (
  origin: string,
  memberId: string,
  token: string,
): string =>
  `${origin}/members/${encodeURIComponent(memberId)}?invite=${encodeURIComponent(token)}`;

// mailto with no address: only subject and body are prefilled.
export const mailtoUrl = ({
  subject,
  body,
}: {
  subject: string;
  body: string;
}): string =>
  `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

// WhatsApp's click-to-chat without a phone number opens the contact picker.
export const whatsAppUrl = (text: string): string =>
  `https://wa.me/?text=${encodeURIComponent(text)}`;

// Web Share API feature detection. Takes the navigator (or undefined on the server) so it is
// testable without a browser.
export const canWebShare = (
  nav: Pick<Navigator, "share"> | undefined,
): boolean => typeof nav?.share === "function";

// The inviteShare i18n key for a failed createHouseholdInviteLink: the rate limit has its own
// message ("try again tomorrow"); anything else is a generic retry.
export const inviteLinkErrorKey = (
  error: unknown,
): "rateLimited" | "createFailed" => {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown } | undefined;
    if (data && data.code === "invite_rate_limited") return "rateLimited";
  }
  return "createFailed";
};

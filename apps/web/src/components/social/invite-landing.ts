// Shared by the /members/$handle invite landing and InviteRedeemer (dashboard layout).

// localStorage key carrying an invite token across the Clerk sign-up redirect.
export const INVITE_KEY = "jigswap.invite";

// Mirrors the server's redeemInvite window: only an account this young may redeem.
export const NEW_MEMBER_WINDOW_MS = 15 * 60 * 1000;

// The signed-in landing hands a live token to InviteRedeemer (store + go to /dashboard) only for
// a brand-new member who is not the link's owner. Existing members stay on the landing: a
// network link offers "follow each other", a household link asks for an in-app invite.
export const shouldHandOffInvite = ({
  memberCreatedAt,
  isSelf,
  invite,
  inviteValid,
  now,
}: {
  memberCreatedAt: number;
  isSelf: boolean;
  invite: string | undefined;
  inviteValid: boolean;
  now: number;
}): boolean =>
  !isSelf &&
  invite !== undefined &&
  invite !== "" &&
  inviteValid &&
  now - memberCreatedAt < NEW_MEMBER_WINDOW_MS;

const MEMBER_PATH = /^\/members\/([^/]+)\/?$/;

// The member and token of an invite link, as sign-up holds it in redirect_url; null for anything
// else. It takes an href or a full URL: Clerk may hand redirect_url back absolute. Only a pointer:
// the server still has to say the token is live for that member (social.inviteContext).
export const inviteHrefTarget = (
  href: unknown,
): { handle: string; token: string } | null => {
  if (typeof href !== "string") return null;
  try {
    const url = new URL(href, "https://jigswap.site");
    const handle = MEMBER_PATH.exec(url.pathname)?.[1];
    const token = url.searchParams.get("invite");
    return handle && token
      ? { handle: decodeURIComponent(handle), token }
      : null;
  } catch {
    return null;
  }
};

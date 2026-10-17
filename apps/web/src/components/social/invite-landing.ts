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

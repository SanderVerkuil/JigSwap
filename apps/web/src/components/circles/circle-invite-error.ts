import { ConvexError } from "convex/values";

// An invite that was accepted, declined, revoked or expired in the meantime: every such refusal
// reads as the same neutral "no longer available".
const UNAVAILABLE_CODES = new Set([
  "InviteNotFound",
  "InviteExpired",
  "InviteNotPending",
]);

// The other codes the circle invite mutations reject with that the UI explains (everything else
// gets the generic message). `RateLimited` is the invite rate limit (lib/rateLimits.ts).
const KNOWN_CODES = new Set([
  "CannotInvite",
  "AlreadyMember",
  "CircleFull",
  "NotCircleAdmin",
  "CircleNotFound",
  "RateLimited",
]);

/** The `circles` key for a "no longer available" invite; render it as a neutral toast. */
export const INVITE_UNAVAILABLE_KEY = "invitations.unavailable";

// The `circles` namespace i18n key describing why a circle invite mutation failed.
export function circleInviteErrorKey(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown } | undefined;
    const code = typeof data?.code === "string" ? data.code : undefined;
    if (code && UNAVAILABLE_CODES.has(code)) return INVITE_UNAVAILABLE_KEY;
    if (code && KNOWN_CODES.has(code)) return `inviteErrors.${code}`;
  }
  return "inviteErrors.generic";
}

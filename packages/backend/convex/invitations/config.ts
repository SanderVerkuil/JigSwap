import { ConvexError, v } from "convex/values";

// Email invitations (#222): shared rules for invitations/. See
// docs/superpowers/specs/2026-10-18-email-invites-design.md, section E.1.

const DAY = 24 * 60 * 60_000;

/** An invitation (its local row and its Clerk invitation) lasts 14 days. */
export const EMAIL_INVITE_TTL_DAYS = 14;
export const EMAIL_INVITE_TTL_MS = EMAIL_INVITE_TTL_DAYS * DAY;

/** At most one invitation email per address in this window, across all inviters. */
export const SEND_LOG_WINDOW_MS = 30 * DAY;

// sendEmailInvite answers no sooner than RESPONSE_FLOOR_MS (+ up to RESPONSE_FLOOR_JITTER_MS)
// after it started, whichever path it took after its first mutation (capped, existing member,
// Clerk refusal, email sent, any failure), so the response time says nothing about the address.
// The floor sits above a normal Clerk + render + email round trip.
export const RESPONSE_FLOOR_MS = 2500;
export const RESPONSE_FLOOR_JITTER_MS = 500;

/** The instant sendEmailInvite may answer, for a call that started at `startedAt`. */
export const responseFloorFrom = (
  startedAt: number,
  random: () => number = Math.random,
): number =>
  startedAt + RESPONSE_FLOOR_MS + random() * RESPONSE_FLOOR_JITTER_MS;

/** Sleep until `until` (epoch ms); returns at once when it has passed. Replaced in tests. */
export const waitUntil = async (until: number): Promise<void> => {
  const ms = until - Date.now();
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
};

// The same floor as ANON_REF_SECRET (social/privacy): a short key would let anyone holding the
// send log test candidate addresses against it.
export const INVITE_EMAIL_HMAC_KEY_MIN_LENGTH = 32;

export const emailInviteKindValidator = v.union(
  v.literal("follow"),
  v.literal("household"),
);

/**
 * The feature switch: on only when the deployment has both the address-HMAC key and the Clerk
 * secret. Reads env lazily (per call), never at module scope.
 */
export const emailInvitesEnabled = (
  env: Record<string, string | undefined> = process.env,
): boolean =>
  !!env["CLERK_SECRET_KEY"] &&
  (env["INVITE_EMAIL_HMAC_KEY"]?.length ?? 0) >=
    INVITE_EMAIL_HMAC_KEY_MIN_LENGTH;

/** sendEmailInvite on a deployment where the feature is switched off. */
export const emailInvitesUnavailable = (): ConvexError<{
  code: string;
  message: string;
}> =>
  new ConvexError({
    code: "EmailInvitesUnavailable",
    message: "Email invitations are not available",
  });

/** The one error for an unknown, foreign or already-resolved invitation ref. */
export const emailInviteUnavailable = (): ConvexError<{
  code: string;
  message: string;
}> =>
  new ConvexError({
    code: "EmailInviteUnavailable",
    message: "This invitation is no longer available",
  });

const encoder = new TextEncoder();

/**
 * The send-log key for a normalised address: HMAC-SHA256(key, ["emailInvite/v1", email]) in hex.
 * Keyed, so the log can't be matched against a list of addresses without the server-only key.
 */
export const emailHmacOf = async (
  key: string,
  email: string,
): Promise<string> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(JSON.stringify(["emailInvite/v1", email])),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

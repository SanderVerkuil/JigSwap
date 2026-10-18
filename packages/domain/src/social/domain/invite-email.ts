import { err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";

// Email invitations (#222): the pure rules for the two pieces of member input that reach an
// invitation email. The address is never stored; the inviter's name is the only user text in it.

/** The longest address accepted (RFC 5321's path limit, as most providers enforce). */
export const INVITE_EMAIL_MAX_LENGTH = 254;

// The WHATWG HTML "valid email address" production, the rule behind <input type="email">.
const HTML_EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * The canonical form of an invitee's address: trimmed and lowercased, so one person has one
 * form for the per-address cap and the member lookup. InvalidEmail when it is not a valid HTML
 * email address or is longer than INVITE_EMAIL_MAX_LENGTH.
 */
export const normalizeInviteEmail = (
  raw: string,
): Result<string, SocialError> => {
  const email = raw.trim().toLowerCase();
  if (email.length > INVITE_EMAIL_MAX_LENGTH || !HTML_EMAIL.test(email)) {
    return err(SocialError.invalidEmail());
  }
  return ok(email);
};

/** The longest inviter name an invitation email shows, in characters. */
export const INVITER_NAME_MAX_LENGTH = 60;

// C0 and C1 control characters plus the Unicode line and paragraph separators.
const LINE_BREAKS_AND_CONTROLS = /[\p{Cc}\u2028\u2029]/gu;

// Invisible format characters: the bidi marks, embeddings, overrides and isolates (U+061C,
// U+200E-U+200F, U+202A-U+202E, U+2066-U+2069) that could reorder the subject, and the
// zero-width ones.
const FORMAT_CHARACTERS = /\p{Cf}/gu;

/**
 * The inviter's display name as an invitation email may show it (in the subject too): every
 * line break and control character becomes a space, invisible format characters (bidi controls,
 * zero-width characters) are dropped, runs of whitespace collapse, and a name
 * longer than INVITER_NAME_MAX_LENGTH characters is cut with an ellipsis. `undefined` when
 * nothing printable is left, so the email falls back to its generic label.
 */
export const inviterNameForEmail = (
  raw: string | undefined,
): string | undefined => {
  const flat = (raw ?? "")
    .replace(LINE_BREAKS_AND_CONTROLS, " ")
    .replace(FORMAT_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length === 0) return undefined;
  const chars = Array.from(flat);
  if (chars.length <= INVITER_NAME_MAX_LENGTH) return flat;
  return `${chars
    .slice(0, INVITER_NAME_MAX_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
};

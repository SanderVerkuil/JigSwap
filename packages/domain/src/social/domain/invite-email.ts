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

// Punctuation and symbols around a word ("(evil.example)", "evil.example,"), ignored when
// deciding whether the word is a link.
const WRAPPING = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
// A host name: dot-separated labels ending in an all-lowercase or all-uppercase top-level
// domain of at least two letters, with an optional port, path or query. A single-letter or
// mixed-case last part ("J.R.R.", "Dr.Who") is not a host. Deliberately broad: there is no list
// of real top-level domains, so a lowercase handle such as "anna.smith" is dropped too (a false
// positive the spec pins). Known gaps the other way: non-ASCII top-level domains and bare IPv4
// addresses are not matched.
const BARE_HOST =
  /^(?:[\p{L}\p{N}-]+\.)+(?:[a-z]{2,}|[A-Z]{2,})(?:[/:?#]\S*)?$/u;

// A word a mail client could turn into a link: anything with a scheme ("://"), a "www." name,
// an email address, or a bare host name.
const isLinkLike = (word: string): boolean => {
  if (word.includes("://")) return true;
  const core = word.replace(WRAPPING, "");
  if (/^www\./i.test(core)) return true;
  const at = core.indexOf("@");
  if (at > 0 && core.slice(at + 1).includes(".")) return true;
  return BARE_HOST.test(core);
};

/**
 * The inviter's display name as an invitation email may show it (never in the subject): every
 * line break and control character becomes a space, invisible format characters (bidi controls,
 * zero-width characters) are dropped, runs of whitespace collapse, every word that looks like a
 * link or an email address is dropped (so a name can't put a clickable address in an email sent
 * as JigSwap), and a name longer than INVITER_NAME_MAX_LENGTH characters is cut with an
 * ellipsis. `undefined` when nothing printable is left, so the email falls back to its generic
 * label.
 */
export const inviterNameForEmail = (
  raw: string | undefined,
): string | undefined => {
  const flat = (raw ?? "")
    .replace(LINE_BREAKS_AND_CONTROLS, " ")
    .replace(FORMAT_CHARACTERS, "")
    .split(/\s+/)
    .filter((word) => word !== "" && !isLinkLike(word))
    .join(" ");
  if (flat.length === 0) return undefined;
  const chars = Array.from(flat);
  if (chars.length <= INVITER_NAME_MAX_LENGTH) return flat;
  return `${chars
    .slice(0, INVITER_NAME_MAX_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
};

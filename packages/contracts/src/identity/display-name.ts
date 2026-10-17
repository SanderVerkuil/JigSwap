// THE single member display-name resolution, shared by the backend (server-side projections) and
// the web app (rendering). It is deliberately locale-free: when a member has no identifiable name
// it returns `undefined`, and the caller supplies the localized generic label (web:
// `useMemberDisplayName`, "Puzzler" / "Puzzelaar").

/**
 * The raw identity fields a member name can be resolved from. Every field is optional because a
 * Clerk account may have no first/last name, no username, and (for anything but the member's own
 * view or the admin console) the email is never available.
 *
 * PRIVACY: only pass `email` when the viewer is allowed to see it (the member themself, or an
 * admin). Server-side projections for other members (`projectMemberIdentity`, `toMemberView`)
 * must never pass it.
 */
export interface MemberNameSource {
  name?: string | null;
  email?: string | null;
  username?: string | null;
}

/** Which field the resolved display name came from. */
export type MemberNameKind = "name" | "email" | "username";

export interface ResolvedMemberName {
  text: string;
  kind: MemberNameKind;
}

// The Clerk sync used to build `${first_name} ${last_name}` from nullable fields, persisting
// literal "null"/"undefined" halves ("null null", "Mara null", "null Jansen"). Only an exact
// token at the start or end is stripped, never a substring of a real name. Done as a token
// scan rather than an edge regex, which backtracks polynomially on long whitespace runs.
const PLACEHOLDERS = new Set(["null", "undefined"]);

const stripPlaceholderEdges = (trimmed: string): string => {
  // [word, sep, word, sep, ..., word]: words at even indices, separators kept verbatim.
  const parts = trimmed.split(/(\s+)/);
  let start = 0;
  let end = parts.length;
  while (start < end && PLACEHOLDERS.has(parts[start])) start += 2;
  while (end > start && PLACEHOLDERS.has(parts[end - 1])) end -= 2;
  return parts.slice(start, end).join("");
};

/**
 * Trim a stored person name and strip legacy "null"/"undefined" placeholder halves. Returns
 * `undefined` when nothing real remains. Used by the resolver and the backfill so both agree on
 * what counts as "no name".
 */
export const normalizeMemberName = (
  raw: string | null | undefined,
): string | undefined => {
  if (raw == null) return undefined;
  const cleaned = stripPlaceholderEdges(raw.trim()).trim();
  return cleaned.length > 0 ? cleaned : undefined;
};

const present = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Resolve how a member is named: full name → email (only if supplied, i.e. visible to the
 * viewer) → username → `undefined` (caller renders a localized generic label).
 */
export const resolveMemberDisplayName = (
  source: MemberNameSource,
): ResolvedMemberName | undefined => {
  const name = normalizeMemberName(source.name);
  if (name) return { text: name, kind: "name" };
  const email = present(source.email);
  if (email) return { text: email, kind: "email" };
  const username = present(source.username);
  if (username) return { text: username, kind: "username" };
  return undefined;
};

/**
 * The avatar initial for a resolved name: the first letter of the name, of an email's local part,
 * or of the username. `undefined` when there is no resolved name — render a generic person icon
 * instead of fabricated letters (never "N" for a legacy "null null").
 */
export const memberInitials = (
  resolved: ResolvedMemberName | undefined,
): string | undefined => {
  if (!resolved) return undefined;
  const base =
    resolved.kind === "email" ? resolved.text.split("@")[0] : resolved.text;
  const first = Array.from(base.replace(/^[^\p{L}\p{N}]+/u, ""))[0];
  return first ? first.toUpperCase() : undefined;
};

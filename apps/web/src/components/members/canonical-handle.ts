// The /members/$handle param a member's page lives at. Pure, so it unit-tests without React.

type HandleSource = {
  memberId: string;
  slug?: string;
  // Optional at runtime: a backend that predates `handle` (the web deployed ahead of Convex).
  handle?: string;
};

/**
 * The server's canonical handle. A backend without `handle` falls back to the slug, which always
 * resolves back to the same member (slugs are looked up before usernames, and setSlug refuses
 * id-shaped values), then to `requested`: the handle the page was opened with, which the server
 * has just resolved to this very member, so the page stays where it is instead of jumping to the
 * bare id. Else the id. Never rebuilt from `username`: another member may hold that string as a
 * slug (SEC-07).
 */
export const canonicalHandleOf = (
  member: HandleSource,
  requested?: string,
): string => member.handle ?? member.slug ?? requested ?? member.memberId;

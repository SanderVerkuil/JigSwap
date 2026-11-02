// Pure helpers for the copy "Message" flow (/messages/new?copy=<id>), kept free of React/Convex
// runtime imports so they unit-test in a plain node environment.

// The route's only search param. The owner is deliberately NOT a param: the backend derives the
// counterpart from the copy (getCopyConversation / startCopyConversation).
export interface CopyMessageSearch {
  copy?: string;
}

export function parseCopyMessageSearch(
  search: Record<string, unknown>,
): CopyMessageSearch {
  const copy = typeof search.copy === "string" ? search.copy.trim() : "";
  return copy ? { copy } : {};
}

// /messages/$threadId's only search param: the puzzle a copy's "Message" brings along into an
// existing DM. It is an instruction for the composer, not part of the address: the thread route
// drops it from the URL as soon as it has read it.
export interface ThreadSearch {
  attach?: string;
}

export function parseThreadSearch(
  search: Record<string, unknown>,
): ThreadSearch {
  const attach = typeof search.attach === "string" ? search.attach.trim() : "";
  return attach ? { attach } : {};
}

// Navigation target for a copy's "Message" action.
export function copyMessageRoute(copyId: string) {
  return { to: "/messages/new" as const, search: { copy: copyId } };
}

// Whether the viewer owns the copy, so "Message" (to yourself) is hidden. Unknown viewer = false;
// the backend still answers `self` for the owner.
export function isOwnCopy(ownerId: string, viewerId: string | undefined) {
  return viewerId !== undefined && ownerId === viewerId;
}

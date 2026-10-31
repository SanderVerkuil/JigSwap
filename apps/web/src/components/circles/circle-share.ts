import { ConvexError } from "convex/values";

// Shared logic of the two places a member manages their circle shares: the circle page's share
// picker (many copies, one circle) and a copy's "Share with circles" dialog (one copy, many
// circles). Both stage ticks against the server's current state and save the difference.

/** The most copies one shareCopiesToCircle call accepts (sharing/shareCopiesToCircle.ts). */
export const SHARE_BATCH_SIZE = 100;

// The codes the share / unshare mutations reject with that the UI explains (everything else gets
// the generic message). CopyNotFound covers a copy that is missing or no longer the member's.
const KNOWN_CODES = new Set([
  "CopyNotFound",
  "CircleNotFound",
  "CannotShareCopy",
  "BatchTooLarge",
]);

/** The `circles` namespace i18n key describing why sharing or unsharing failed. */
export function circleShareErrorKey(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown } | undefined;
    const code = typeof data?.code === "string" ? data.code : undefined;
    if (code && KNOWN_CODES.has(code)) return `shareErrors.${code}`;
  }
  return "shareErrors.generic";
}

interface ShareableCopy {
  availability: { forTrade: boolean; forSale: boolean; forLend: boolean };
  visibility?: "private" | "visible";
}

/**
 * Why circle members won't see this copy even once it is shared, or null when they will: a private
 * copy stays private, and the circle rule only reveals a copy that is offered for swap, loan or
 * sale (backend library/canViewCopy.ts).
 */
export function circleHiddenReason(
  copy: ShareableCopy,
): "private" | "notOffered" | null {
  if (copy.visibility === "private") return "private";
  const { forTrade, forSale, forLend } = copy.availability;
  return forTrade || forSale || forLend ? null : "notOffered";
}

/** Staged ticks: id → wanted shared state, holding only the ids that differ from the server. */
export type StagedShares = ReadonlyMap<string, boolean>;

/** Flip one id's tick. Ticking it back to the server's state drops it from the staged changes. */
export function toggleStaged(
  staged: StagedShares,
  id: string,
  sharedNow: boolean,
): StagedShares {
  const next = new Map(staged);
  const want = !(staged.get(id) ?? sharedNow);
  if (want === sharedNow) next.delete(id);
  else next.set(id, want);
  return next;
}

/** The staged ids to share and to stop sharing, in staging order. */
export function stagedChanges(staged: StagedShares): {
  adds: string[];
  removes: string[];
} {
  const adds: string[] = [];
  const removes: string[] = [];
  for (const [id, want] of staged) (want ? adds : removes).push(id);
  return { adds, removes };
}

/** `ids` in consecutive chunks of at most `size`. */
export function chunked<T>(ids: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

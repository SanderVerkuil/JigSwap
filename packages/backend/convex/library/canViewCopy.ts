import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { profileVisibilityOf } from "../social/privacy";
import { collectCircleSharedCopies } from "./circleSharedCopies";

// A copy is "open" iff at least one exchange-availability flag is set (identical to
// browseOwnedPuzzles/getPuzzleDefinitionView).
const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

// Reusable per-request context so bulk callers (e.g. the completions enrichment) don't rebuild
// the circle-shared set or re-read owner profiles per copy. `ownerVisibility` is a mutable memo.
export interface CopyViewContext {
  readonly circleSharedOpenIds: Set<string>;
  readonly ownerVisibility: Map<string, "public" | "private">;
}

export const buildCopyViewContext = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<CopyViewContext> => {
  const circleShared = (await collectCircleSharedCopies(ctx, viewerId)).filter(
    isOpen,
  );
  return {
    circleSharedOpenIds: new Set(
      circleShared.map((c) => c._id as unknown as string),
    ),
    ownerVisibility: new Map(),
  };
};

// THE single copy-reachability gate (context form). A copy is viewable by `viewerId` iff:
//   1. the viewer owns it; OR
//   2. the viewer currently HOLDS it (heldBy) — the member physically holding a copy may view its
//      page; they can already log solves against it from the Borrowed page; OR
//   3. the owner's profile is PUBLIC and the copy is OPEN (at least one availability flag); OR
//   4. the copy is shared into a circle the viewer belongs to.
export const canViewCopyWithContext = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
  context: CopyViewContext,
): Promise<boolean> => {
  if (copy.ownerId === viewerId) return true;
  if (copy.heldBy === viewerId) return true;

  if (isOpen(copy)) {
    const key = copy.ownerId as unknown as string;
    let visibility = context.ownerVisibility.get(key);
    if (visibility === undefined) {
      visibility = await profileVisibilityOf(ctx, copy.ownerId);
      context.ownerVisibility.set(key, visibility);
    }
    if (visibility === "public") return true;
  }

  return context.circleSharedOpenIds.has(copy._id as unknown as string);
};

// Single-copy convenience wrapper. The identity short-circuits are duplicated here ON PURPOSE:
// without them every existing call site would pay the circle-shared collection even for the
// owner/holder fast paths, which today return before it.
export const canViewCopy = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<boolean> => {
  if (copy.ownerId === viewerId || copy.heldBy === viewerId) return true;
  return canViewCopyWithContext(
    ctx,
    viewerId,
    copy,
    await buildCopyViewContext(ctx, viewerId),
  );
};

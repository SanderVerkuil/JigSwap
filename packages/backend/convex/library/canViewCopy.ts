import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { householdMateIds } from "../household/memberships";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";
import { collectCircleSharedCopies } from "./circleSharedCopies";
import { isCopyPrivate } from "./copyVisibility";

// A copy is "open" iff at least one exchange-availability flag is set (identical to
// browseOwnedPuzzles/getPuzzleDefinitionView).
const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

// Reusable per-request context so bulk callers (e.g. the completions enrichment) don't rebuild
// the circle-shared set or re-read owner profiles per copy, and can't accidentally pass a
// mismatched viewerId to `canViewCopyWithContext` (it's stamped in at construction). `ownerVisibility`
// and `mutualWithOwner` are mutable per-owner memos.
export interface CopyViewContext {
  readonly viewerId: Id<"users">;
  readonly circleSharedOpenIds: ReadonlySet<Id<"ownedPuzzles">>;
  // The other members of the viewer's household (empty when none): their copies are in the
  // viewer's library regardless of availability or profile visibility.
  readonly householdMateIds: ReadonlySet<Id<"users">>;
  readonly ownerVisibility: Map<Id<"users">, "public" | "private">;
  readonly mutualWithOwner: Map<Id<"users">, boolean>;
}

export const buildCopyViewContext = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<CopyViewContext> => {
  const circleShared = (await collectCircleSharedCopies(ctx, viewerId)).filter(
    isOpen,
  );
  return {
    viewerId,
    circleSharedOpenIds: new Set(circleShared.map((c) => c._id)),
    householdMateIds: await householdMateIds(ctx, viewerId),
    ownerVisibility: new Map(),
    mutualWithOwner: new Map(),
  };
};

// THE single copy-reachability gate (context form). A copy is viewable by `context.viewerId` iff:
//   1. the viewer owns it; OR
//   2. the viewer currently HOLDS it (heldBy) — the member physically holding a copy may view its
//      page; they can already log solves against it from the Borrowed page; OR
//   3. the owner's profile is PUBLIC and the copy is OPEN (at least one availability flag); OR
//   4. the copy is shared into a circle the viewer belongs to; OR
//   5. the owner is in the viewer's household (any household permission — "view" still views); OR
//   6. the viewer and the owner are MUTUAL followers (both follow edges) — friends see the whole
//      library, open or not, whatever the owner's profile visibility.
// ...EXCEPT that a PRIVATE copy (effectiveCopyVisibility — the owner's per-copy toggle) stops after
// rules 1, 2 and 5: only its owner, its current holder and the owner's household may see it. Rules
// 3 and 4 already require an OPEN copy, which is never private, so in practice this removes rule 6
// for private copies. There is deliberately no admin rule here; admin surfaces use their own reads.
// VIEWING only: exchange proposals stay gated by the availability flags in the domain
// (proposeExchange -> CopyNotAvailable), so rule 6 never makes a non-open copy exchangeable.
export const canViewCopyWithContext = async (
  ctx: QueryCtx,
  copy: Doc<"ownedPuzzles">,
  context: CopyViewContext,
): Promise<boolean> => {
  const viewerId = context.viewerId;
  if (copy.ownerId === viewerId) return true;
  if (copy.heldBy === viewerId) return true;
  if (context.householdMateIds.has(copy.ownerId)) return true;
  if (isCopyPrivate(copy)) return false;

  if (isOpen(copy)) {
    let visibility = context.ownerVisibility.get(copy.ownerId);
    if (visibility === undefined) {
      visibility = await profileVisibilityOf(ctx, copy.ownerId);
      context.ownerVisibility.set(copy.ownerId, visibility);
    }
    if (visibility === "public") return true;
  }

  if (context.circleSharedOpenIds.has(copy._id)) return true;

  let mutual = context.mutualWithOwner.get(copy.ownerId);
  if (mutual === undefined) {
    mutual = await areMutualFollowers(ctx, viewerId, copy.ownerId);
    context.mutualWithOwner.set(copy.ownerId, mutual);
  }
  return mutual;
};

// Single-copy convenience wrapper. The identity short-circuits AND the public+open check are
// duplicated here ON PURPOSE, mirroring the pre-refactor gate's order exactly: without them every
// existing call site would pay the full circle-shared collection (`buildCopyViewContext`) even for
// the owner/holder/public-open fast paths, which today return before it.
export const canViewCopy = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<boolean> => {
  if (copy.ownerId === viewerId || copy.heldBy === viewerId) return true;
  if (
    isOpen(copy) &&
    (await profileVisibilityOf(ctx, copy.ownerId)) === "public"
  ) {
    return true;
  }
  return canViewCopyWithContext(
    ctx,
    copy,
    await buildCopyViewContext(ctx, viewerId),
  );
};

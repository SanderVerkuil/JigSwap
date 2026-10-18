import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { householdMateIds } from "../household/memberships";
import { blockedEitherWaySet, isBlockedEitherWay } from "../social/blocks";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";
import { isCircleSharedWithViewer } from "./circleSharedCopies";
import { isCopyPrivate } from "./copyVisibility";

// A copy is "open" iff at least one exchange-availability flag is set (identical to
// browseOwnedPuzzles/getPuzzleDefinitionView).
const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

// Which exchange statuses let the other party see a PRIVATE copy involved in it (rule P below). Every
// status is mapped explicitly (`satisfies Record<…>` makes a new status a type error here):
//   proposed / accepted -> yes: the owner put the copy in front of this member to trade on.
//   completed / disputed -> yes: the exchange went ahead; the parties keep its history (and a
//                           dispute needs both parties to see what it is about).
//   rejected / cancelled -> no: it never became a shared transaction, so the owner's privacy choice
//                           wins again.
const EXCHANGE_STATUSES_REVEALING_COPY = {
  proposed: true,
  accepted: true,
  completed: true,
  disputed: true,
  rejected: false,
  cancelled: false,
} as const satisfies Record<Doc<"exchanges">["status"], boolean>;

// Rule P: the viewer is a party (initiator or recipient) of a revealing exchange in which the copy
// is the offered or the requested side. Two index reads (by_offered_copy / by_requested_copy, both
// bounded by the copy's own exchanges); only reached for a private copy no earlier rule passed, so
// bulk callers don't need a memo.
const isExchangePartyFor = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<boolean> => {
  const [offered, requested] = await Promise.all([
    ctx.db
      .query("exchanges")
      .withIndex("by_offered_copy", (q) => q.eq("offeredPuzzleId", copy._id))
      .collect(),
    ctx.db
      .query("exchanges")
      .withIndex("by_requested_copy", (q) =>
        q.eq("requestedPuzzleId", copy._id),
      )
      .collect(),
  ]);
  return [...offered, ...requested].some(
    (exchange) =>
      EXCHANGE_STATUSES_REVEALING_COPY[exchange.status] &&
      (exchange.initiatorId === viewerId || exchange.recipientId === viewerId),
  );
};

// Reusable per-request context so bulk callers (e.g. the completions enrichment) don't re-read the
// household or owner profiles per copy, and can't accidentally pass a
// mismatched viewerId to `canViewCopyWithContext` (it's stamped in at construction). `ownerVisibility`
// and `mutualWithOwner` are mutable per-owner memos. The circle clause is decided per copy
// (`isCircleSharedWithViewer`, O(shares of that copy)), never by collecting every share in every
// circle the viewer is in (#190).
export interface CopyViewContext {
  readonly viewerId: Id<"users">;
  // The other members of the viewer's household (empty when none): their copies are in the
  // viewer's library regardless of availability or profile visibility.
  readonly householdMateIds: ReadonlySet<Id<"users">>;
  // Members blocked either way with the viewer: their copies are unviewable for the viewer
  // (unless the viewer holds the copy), whatever household, circle or public rule would apply.
  readonly blockedIds: ReadonlySet<Id<"users">>;
  readonly ownerVisibility: Map<Id<"users">, "public" | "private">;
  readonly mutualWithOwner: Map<Id<"users">, boolean>;
}

export const buildCopyViewContext = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
): Promise<CopyViewContext> => {
  return {
    viewerId,
    householdMateIds: await householdMateIds(ctx, viewerId),
    blockedIds: await blockedEitherWaySet(ctx, viewerId),
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
// rules 1, 2 and 5 plus one private-only rule:
//   P. the viewer is the other PARTY of an exchange involving the copy (offered or requested side)
//      that is live or went ahead — see EXCHANGE_STATUSES_REVEALING_COPY.
// Rules 3 and 4 already require an OPEN copy, which is never private, so in practice this replaces
// rule 6 with rule P for private copies. There is deliberately no admin rule here; admin surfaces use their own reads.
// A block either way between viewer and owner vetoes every rule after 1-2, rule P included (the
// holder keeps access).
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
  if (context.blockedIds.has(copy.ownerId)) return false;
  if (context.householdMateIds.has(copy.ownerId)) return true;
  if (isCopyPrivate(copy)) return isExchangePartyFor(ctx, viewerId, copy);

  if (isOpen(copy)) {
    let visibility = context.ownerVisibility.get(copy.ownerId);
    if (visibility === undefined) {
      visibility = await profileVisibilityOf(ctx, copy.ownerId);
      context.ownerVisibility.set(copy.ownerId, visibility);
    }
    if (visibility === "public") return true;
  }

  if (isOpen(copy) && (await isCircleSharedWithViewer(ctx, viewerId, copy))) {
    return true;
  }

  let mutual = context.mutualWithOwner.get(copy.ownerId);
  if (mutual === undefined) {
    mutual = await areMutualFollowers(ctx, viewerId, copy.ownerId);
    context.mutualWithOwner.set(copy.ownerId, mutual);
  }
  return mutual;
};

// Single-copy convenience wrapper. The identity short-circuits AND the public+open check are
// duplicated here ON PURPOSE, mirroring the pre-refactor gate's order exactly: without them every
// existing call site would pay the household read (`buildCopyViewContext`) even for the
// owner/holder/public-open fast paths, which today return before it.
export const canViewCopy = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<boolean> => {
  if (copy.ownerId === viewerId || copy.heldBy === viewerId) return true;
  if (await isBlockedEitherWay(ctx, viewerId, copy.ownerId)) return false;
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

import { mayExchangeVia, type ExchangeRoute } from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { householdMateIds } from "../household/memberships";
import { isBlockedEitherWay } from "../social/blocks";
import { areMutualFollowers, profileVisibilityOf } from "../social/privacy";
import { isOpen } from "./canViewCopy";
import { circlesSharingCopyWith } from "./circleSharedCopies";
import { isCopyPrivate } from "./copyVisibility";

// Every route by which `memberId` reaches another member's copy, for Sharing's `mayExchangeVia`.
// Mirrors canViewCopy's rules 3-6 but collects all of them instead of stopping at the first, and
// carries the member's own permission level for each circle route:
//   public       — rule 3: owner's profile public and the copy open
//   circle       — rule 4: an open copy shared into a circle both are current members of
//   household    — rule 5
//   mutualFollow — rule 6 (not for a private copy, as in canViewCopy)
// A block either way leaves no route. The owner and a mere holder have no route: neither asks the
// owner for an exchange through a relationship.
export const exchangeRoutesFor = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<ExchangeRoute[]> => {
  if (copy.ownerId === memberId) return [];
  if (await isBlockedEitherWay(ctx, memberId, copy.ownerId)) return [];

  const routes: ExchangeRoute[] = [];
  if ((await householdMateIds(ctx, memberId)).has(copy.ownerId)) {
    routes.push({ kind: "household" });
  }
  if (isCopyPrivate(copy)) return routes;

  if (
    isOpen(copy) &&
    (await profileVisibilityOf(ctx, copy.ownerId)) === "public"
  ) {
    routes.push({ kind: "public" });
  }
  if (isOpen(copy)) {
    for (const circle of await circlesSharingCopyWith(ctx, memberId, copy)) {
      const seat = circle.memberships.find((m) => m.memberId === memberId);
      if (seat) routes.push({ kind: "circle", level: seat.permission });
    }
  }
  if (await areMutualFollowers(ctx, memberId, copy.ownerId)) {
    routes.push({ kind: "mutualFollow" });
  }
  return routes;
};

// Whether the viewer may send a request for this copy right now, for the UI to mirror propose's
// server-side gate: not their own copy, open for some exchange, and a route that allows it.
export const viewerMayRequestCopy = async (
  ctx: QueryCtx,
  viewerId: Id<"users">,
  copy: Doc<"ownedPuzzles">,
): Promise<boolean> =>
  copy.ownerId !== viewerId &&
  isOpen(copy) &&
  mayExchangeVia(await exchangeRoutesFor(ctx, viewerId, copy));

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { householdMateIds } from "../household/memberships";

// THE single source of a copy's effective visibility. Every read that decides whether someone
// other than the owner may see (or count) a copy goes through here, never through the raw
// `ownedPuzzles.visibility` column.

export type CopyVisibility = "private" | "visible";

type VisibilityFields = Pick<
  Doc<"ownedPuzzles">,
  "availability" | "visibility" | "visibilityAuthoritative"
>;

// Offered for at least one kind of exchange.
const isOffered = (row: VisibilityFields): boolean =>
  row.availability.forTrade ||
  row.availability.forSale ||
  row.availability.forLend;

/**
 * The visibility a copy row actually has:
 *   - offered for swap/lend/sale -> "visible" (an offer implies visibility — defense in depth for a
 *     stored private+offered combination the domain now rejects on write);
 *   - `visibilityAuthoritative` set -> the stored value (unset -> "visible");
 *   - otherwise (a row from before the per-copy toggle, backfilled or not) -> "visible": its stored
 *     "private" was the old domain default, not the owner's choice.
 * Order-independent by construction: correct before and after the backfill has run.
 */
export const effectiveCopyVisibility = (
  row: VisibilityFields,
): CopyVisibility => {
  if (isOffered(row)) return "visible";
  if (row.visibilityAuthoritative === true) return row.visibility ?? "visible";
  return "visible";
};

export const isCopyPrivate = (row: VisibilityFields): boolean =>
  effectiveCopyVisibility(row) === "private";

/**
 * Whether `viewerId` may see (and count) `ownerId`'s PRIVATE copies: the owner themself or a
 * member of the owner's household. The current holder of a single copy also sees it, but that is
 * per copy (canViewCopy rule 2), not per owner. `null` (anonymous) never does.
 */
export const seesPrivateCopiesOf = async (
  ctx: QueryCtx,
  viewerId: Id<"users"> | null,
  ownerId: Id<"users">,
): Promise<boolean> => {
  if (viewerId === null) return false;
  if (viewerId === ownerId) return true;
  return (await householdMateIds(ctx, viewerId)).has(ownerId);
};

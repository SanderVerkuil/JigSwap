import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { householdMateIds } from "../household/memberships";

// THE single source of a copy's effective visibility. Every read that decides whether someone
// other than the owner may see (or count) a copy goes through here, never through the raw
// `ownedPuzzles.visibility` column: that column holds the OWNER'S CHOICE, which stays "private" on a
// copy that is currently offered (the offer makes it visible only while it lasts).

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
 * The owner's chosen visibility (the domain SharingSetting's `visibility`), whether or not the copy
 * is offered right now:
 *   - `visibilityAuthoritative` set -> the stored value (unset -> "visible");
 *   - otherwise (a row from before the per-copy toggle, backfilled or not) -> "visible": its stored
 *     "private" was the old domain default, not the owner's choice.
 * Only the owner's side (the domain load, manager views) reads this; who may see the copy is
 * effectiveCopyVisibility.
 */
export const copyVisibilityPreference = (
  row: VisibilityFields,
): CopyVisibility =>
  row.visibilityAuthoritative === true
    ? (row.visibility ?? "visible")
    : "visible";

/**
 * The visibility a copy row actually has: "visible" while it is offered for swap/lend/sale (an offer
 * nobody can see is meaningless), otherwise the owner's choice (copyVisibilityPreference). A stored
 * "private" on an offered copy is the owner's choice, kept for when the offer is withdrawn.
 * Order-independent by construction: correct before and after the backfill has run.
 */
export const effectiveCopyVisibility = (
  row: VisibilityFields,
): CopyVisibility =>
  isOffered(row) ? "visible" : copyVisibilityPreference(row);

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

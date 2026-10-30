import {
  toCopyId,
  toMemberId,
  type CopyId,
  type CopyPort,
  type CopyView,
  type MemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { coManagerIdsOf } from "../../household/copyAccess";

// Exchange's view of one copy row, given its co-managers (household/copyAccess's co-manager rule).
// Shared with bulk readers (getOfferableCopies) that already hold the row and resolve the
// co-managers once per owner.
export const toCopyView = (
  row: Doc<"ownedPuzzles">,
  coManagerIds: MemberId[],
): CopyView => ({
  id: toCopyId(row._id),
  ownerId: toMemberId(row.ownerId),
  // Household members who may act as co-owner (e.g. offer it in a swap).
  coManagerIds,
  // A borrower while it is out on loan; unset (legacy rows too) means the owner holds it.
  heldBy: row.heldBy === undefined ? undefined : toMemberId(row.heldBy),
  availability: {
    forTrade: row.availability.forTrade,
    forSale: row.availability.forSale,
    forLend: row.availability.forLend,
  },
});

// Driven adapter for the CopyPort: Exchange's read-only, anti-corruption view of a
// Personal Library copy (`ownedPuzzles`). Exchange never touches Library's table shape.
export const convexCopyPort = (ctx: QueryCtx): CopyPort => ({
  async getCopy(copyId: CopyId): Promise<CopyView | null> {
    const row = await ctx.db.get(copyId as unknown as Id<"ownedPuzzles">);
    if (!row) return null;
    return toCopyView(row, await coManagerIdsOf(ctx, row));
  },
});

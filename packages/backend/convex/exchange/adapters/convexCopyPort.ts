import {
  type CopyId,
  type CopyPort,
  type CopyView,
  toCopyId,
  toMemberId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { coManagerIdsOf } from "../../household/copyAccess";

// Driven adapter for the CopyPort: Exchange's read-only, anti-corruption view of a
// Personal Library copy (`ownedPuzzles`). Exchange never touches Library's table shape.
export const convexCopyPort = (ctx: QueryCtx): CopyPort => ({
  async getCopy(copyId: CopyId): Promise<CopyView | null> {
    const row = await ctx.db.get(copyId as unknown as Id<"ownedPuzzles">);
    if (!row) return null;
    return {
      id: toCopyId(row._id),
      ownerId: toMemberId(row.ownerId),
      // Household members who may act as co-owner (e.g. offer it in a swap).
      coManagerIds: await coManagerIdsOf(ctx, row),
      availability: {
        forTrade: row.availability.forTrade,
        forSale: row.availability.forSale,
        forLend: row.availability.forLend,
      },
    };
  },
});

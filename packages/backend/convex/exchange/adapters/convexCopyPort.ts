import { type CopyId, type CopyPort, type CopyView, type MemberId, toId } from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

// Driven adapter for the CopyPort: Exchange's read-only, anti-corruption view of a
// Personal Library copy (`ownedPuzzles`). Exchange never touches Library's table shape.
export const convexCopyPort = (ctx: QueryCtx): CopyPort => ({
  async getCopy(copyId: CopyId): Promise<CopyView | null> {
    const row = await ctx.db.get(copyId as unknown as Id<"ownedPuzzles">);
    if (!row) return null;
    return {
      id: toId<"CopyId">(row._id),
      ownerId: toId<"MemberId">(row.ownerId) as MemberId,
      availability: {
        forTrade: row.availability.forTrade,
        forSale: row.availability.forSale,
        forLend: row.availability.forLend,
      },
    };
  },
});

import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";

// Surfaces an existing APPROVED catalog puzzle carrying the extracted EAN/UPC, to drive the
// "already on JigSwap" dedup branch. Approved-only by design: never leak another member's
// unapproved submission. A rare pending-collision is caught later by the submit barcode rule.
export const findPuzzleByBarcode = internalQuery({
  args: { ean: v.optional(v.string()), upc: v.optional(v.string()) },
  handler: async (ctx, { ean, upc }) => {
    const candidates: Doc<"puzzles">[] = [];
    if (ean) {
      const row = await ctx.db
        .query("puzzles")
        .withIndex("by_ean", (q) => q.eq("ean", ean))
        .first();
      if (row) candidates.push(row);
    }
    if (upc) {
      const row = await ctx.db
        .query("puzzles")
        .withIndex("by_upc", (q) => q.eq("upc", upc))
        .first();
      if (row) candidates.push(row);
    }
    const match = candidates.find((p) => p.status === "approved");
    if (!match) return null;

    return {
      puzzleId: match._id as string,
      aggregateId: match.aggregateId,
      title: match.title,
      brand: match.brand,
      pieceCount: match.pieceCount,
      imageUrl: match.image ? (await ctx.storage.getUrl(match.image)) ?? undefined : undefined,
    };
  },
});

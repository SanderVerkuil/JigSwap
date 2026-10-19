import type { PuzzleSummaryView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalQuery, query, type QueryCtx } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import { toPuzzleSummaryView } from "./mappers";

const findApprovedByBarcode = async (
  ctx: QueryCtx,
  { ean, upc }: { ean?: string; upc?: string },
) => {
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
  return candidates.find((p) => p.status === "approved") ?? null;
};

// Surfaces an existing APPROVED catalog puzzle carrying the extracted EAN/UPC, to drive the
// "already on JigSwap" dedup branch. Approved-only by design: never leak another member's
// unapproved submission. v1 scope: the design doc's "caller's own pending submissions" branch
// is deferred (would require threading the submitter id through this internal query); a rare
// own-pending collision is instead caught by the submit barcode-uniqueness rule.
export const findPuzzleByBarcode = internalQuery({
  args: { ean: v.optional(v.string()), upc: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const match = await findApprovedByBarcode(ctx, args);
    if (!match) return null;

    return {
      puzzleId: match._id as unknown as string,
      aggregateId: match.aggregateId,
      title: match.title,
      brand: match.brand,
      pieceCount: match.pieceCount,
      imageUrl: match.image
        ? ((await boxArtUrl(ctx, match.image)) ?? undefined)
        : undefined,
    };
  },
});

// Member-facing barcode lookup for the add-copy picker. The raw code is re-normalised here (the
// client's detection is a convenience, not trusted): only a 12/13-digit code is looked up (the
// catalogue stores no EAN-8). It
// returns the same summary DTO the picker's search rows use, so the match renders as a card.
// A 12-digit code is a UPC-A, which may also have been stored as its 0-prefixed EAN-13.
export const lookupPuzzleByBarcode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<PuzzleSummaryView | null> => {
    await requireMember(ctx);
    const digits = code.replace(/[\s-]/g, "");
    if (!/^(\d{12}|\d{13})$/.test(digits)) return null;
    const match =
      digits.length === 12
        ? await findApprovedByBarcode(ctx, { upc: digits, ean: `0${digits}` })
        : await findApprovedByBarcode(ctx, { ean: digits });
    if (!match) return null;
    return toPuzzleSummaryView(
      match,
      match.image ? await boxArtUrl(ctx, match.image) : null,
    );
  },
});

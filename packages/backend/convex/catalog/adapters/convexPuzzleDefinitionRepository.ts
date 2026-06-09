import type {
  PuzzleDefinition,
  PuzzleDefinitionId,
  PuzzleDefinitionRepository,
} from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./mapper";

// Driven adapter for the PuzzleDefinitionRepository port over `ctx.db`. The only place the
// `puzzles` table is read/written for the domain path; the mapper is the ACL.
export const convexPuzzleDefinitionRepository = (
  ctx: MutationCtx,
): PuzzleDefinitionRepository => ({
  async findById(id: PuzzleDefinitionId): Promise<PuzzleDefinition | null> {
    const row = await ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
    return row ? toDomain(row) : null;
  },

  async save(definition: PuzzleDefinition): Promise<void> {
    const row = toRow(definition);
    const existing = await ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.aggregateId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("puzzles", row);
  },

  // Barcode-uniqueness lookup: a value may be an EAN or a UPC, so probe both indexes.
  async findByBarcode(barcode: string): Promise<PuzzleDefinition | null> {
    const byEan = await ctx.db
      .query("puzzles")
      .withIndex("by_ean", (q) => q.eq("ean", barcode))
      .first();
    if (byEan) return toDomain(byEan);
    const byUpc = await ctx.db
      .query("puzzles")
      .withIndex("by_upc", (q) => q.eq("upc", barcode))
      .first();
    return byUpc ? toDomain(byUpc) : null;
  },
});

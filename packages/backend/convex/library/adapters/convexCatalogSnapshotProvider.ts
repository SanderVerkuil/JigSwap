import {
  CatalogSnapshot,
  type CatalogSnapshotProvider,
  type PuzzleDefinitionId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

// Driven adapter for the CatalogSnapshotProvider port: the ACL SOURCE through which Catalog
// product data enters the Library. Reads the `puzzles` row for a PuzzleDefinitionId and maps it
// into a denormalised CatalogSnapshot. The Library never imports the Catalog context.
export const convexCatalogSnapshotProvider = (
  ctx: QueryCtx,
): CatalogSnapshotProvider => ({
  async getSnapshot(
    puzzleDefinitionId: PuzzleDefinitionId,
  ): Promise<CatalogSnapshot | null> {
    // Domain-written puzzles carry an aggregateId; resolve by it first.
    let row: Doc<"puzzles"> | null = await ctx.db
      .query("puzzles")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", puzzleDefinitionId as string),
      )
      .unique();

    // Fallback for legacy puzzles that predate aggregateId: the id may be a raw Convex _id.
    if (!row) {
      row = await ctx.db.get(
        puzzleDefinitionId as unknown as Id<"puzzles">,
      );
    }
    if (!row) return null;

    return CatalogSnapshot.create({
      puzzleDefinitionId,
      title: row.title,
      pieceCount: row.pieceCount,
      brand: row.brand,
      // The thumbnail is the box-art image storage ref (an opaque string handle to the domain).
      thumbnail: row.image as unknown as string | undefined,
    });
  },
});

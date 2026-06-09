import {
  type CatalogCategoryId,
  type PuzzleDefinition,
  type PuzzleDefinitionId,
  type PuzzleDefinitionRepository,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./mapper";

// Driven adapter for the PuzzleDefinitionRepository port over `ctx.db`. The only place the
// `puzzles` table is read/written for the domain path; the mapper is the ACL.
export const convexPuzzleDefinitionRepository = (
  ctx: MutationCtx,
): PuzzleDefinitionRepository => {
  // Resolve the real `adminCategories._id` for a Catalog CatalogCategoryId aggregateId. The
  // `category` FK column is typed `v.id("adminCategories")`, so it must hold a genuine document
  // id, not the aggregateId.
  const resolveCategoryId = async (
    categoryAggregateId: CatalogCategoryId,
  ): Promise<Id<"adminCategories">> => {
    const byAggregateId = await ctx.db
      .query("adminCategories")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", categoryAggregateId as string),
      )
      .unique();
    if (byAggregateId) return byAggregateId._id;
    // Fallback: a legacy category that predates aggregateId — the value may be a raw `_id`.
    return categoryAggregateId as unknown as Id<"adminCategories">;
  };

  // Map a stored `adminCategories._id` back to its CatalogCategoryId aggregateId for the domain.
  const categoryAggregateId = async (
    category: Id<"adminCategories"> | undefined,
  ): Promise<CatalogCategoryId | undefined> => {
    if (!category) return undefined;
    const row = await ctx.db.get(category);
    // A backfilled category carries its aggregateId; a legacy row falls back to its raw `_id`.
    return toId<"CatalogCategoryId">(
      (row?.aggregateId ?? (category as unknown as string)) as string,
    ) as CatalogCategoryId;
  };

  const hydrate = async (row: Doc<"puzzles">): Promise<PuzzleDefinition> =>
    toDomain(row, await categoryAggregateId(row.category));

  return {
    async findById(id: PuzzleDefinitionId): Promise<PuzzleDefinition | null> {
      const row = await ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
        .unique();
      return row ? hydrate(row) : null;
    },

    async save(definition: PuzzleDefinition): Promise<void> {
      const mapped = toRow(definition);
      const category = definition.toState().category;
      const row = {
        ...mapped,
        category: category ? await resolveCategoryId(category) : undefined,
      };
      const existing = await ctx.db
        .query("puzzles")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", row.aggregateId),
        )
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
      if (byEan) return hydrate(byEan);
      const byUpc = await ctx.db
        .query("puzzles")
        .withIndex("by_upc", (q) => q.eq("upc", barcode))
        .first();
      return byUpc ? hydrate(byUpc) : null;
    },
  };
};

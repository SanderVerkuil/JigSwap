import {
  CatalogCategory,
  type CatalogCategoryId,
  type CatalogCategoryRepository,
  type CatalogCategoryState,
  toId,
} from "@jigswap/domain";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// ACL between an `adminCategories` row and the CatalogCategory aggregate.
type CategoryRow = Omit<Doc<"adminCategories">, "_id" | "_creationTime">;

const toDomain = (row: Doc<"adminCategories">): CatalogCategory =>
  CatalogCategory.rehydrate({
    id: toId<"CatalogCategoryId">(row.aggregateId as string),
    name: row.name,
    description: row.description,
    color: row.color,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  });

const toRow = (category: CatalogCategory): CategoryRow => {
  const state: CatalogCategoryState = category.toState();
  return {
    aggregateId: state.id as string,
    name: state.name,
    description: state.description,
    color: state.color,
    isActive: state.isActive,
    sortOrder: state.sortOrder,
    createdAt: state.createdAt.getTime(),
    updatedAt: state.updatedAt.getTime(),
  };
};

// Driven adapter for the CatalogCategoryRepository port over the `adminCategories` table.
export const convexCatalogCategoryRepository = (
  ctx: MutationCtx,
): CatalogCategoryRepository => ({
  async findById(id: CatalogCategoryId): Promise<CatalogCategory | null> {
    const row = await ctx.db
      .query("adminCategories")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
    return row ? toDomain(row) : null;
  },

  async save(category: CatalogCategory): Promise<void> {
    const row = toRow(category);
    const existing = await ctx.db
      .query("adminCategories")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.aggregateId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("adminCategories", row);
  },

  // Public taxonomy: only domain-written, active rows (legacy rows lack an aggregateId).
  async listActive(): Promise<readonly CatalogCategory[]> {
    const rows = await ctx.db
      .query("adminCategories")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    return rows
      .filter((row) => row.aggregateId !== undefined)
      .map((row) => toDomain(row));
  },
});

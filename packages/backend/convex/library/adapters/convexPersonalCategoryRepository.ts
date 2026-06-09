import {
  type OwnerId,
  PersonalCategory,
  type PersonalCategoryId,
  type PersonalCategoryRepository,
  type PersonalCategoryState,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// ACL between a `categories` row and the PersonalCategory aggregate.
type CategoryRow = Omit<Doc<"categories">, "_id" | "_creationTime">;

const toDomain = (row: Doc<"categories">): PersonalCategory =>
  PersonalCategory.rehydrate({
    id: toId<"PersonalCategoryId">(row.aggregateId as string),
    ownerId: toId<"OwnerId">(row.userId as unknown as string) as OwnerId,
    name: row.name,
    color: row.color,
    description: row.description,
    isDefault: row.isDefault,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  });

const toRow = (category: PersonalCategory): CategoryRow => {
  const state: PersonalCategoryState = category.toState();
  return {
    aggregateId: state.id as string,
    userId: state.ownerId as unknown as Id<"users">,
    name: state.name,
    color: state.color,
    description: state.description,
    isDefault: state.isDefault,
    createdAt: state.createdAt.getTime(),
    updatedAt: state.updatedAt.getTime(),
  };
};

// Driven adapter for the PersonalCategoryRepository port over the `categories` table.
export const convexPersonalCategoryRepository = (
  ctx: MutationCtx,
): PersonalCategoryRepository => ({
  async findById(id: PersonalCategoryId): Promise<PersonalCategory | null> {
    const row = await ctx.db
      .query("categories")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();
    return row ? toDomain(row) : null;
  },

  async save(category: PersonalCategory): Promise<void> {
    const row = toRow(category);
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", row.aggregateId),
      )
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("categories", row);
  },

  async listByOwner(ownerId: OwnerId): Promise<readonly PersonalCategory[]> {
    const rows = await ctx.db
      .query("categories")
      .withIndex("by_user", (q) =>
        q.eq("userId", ownerId as unknown as Id<"users">),
      )
      .collect();
    return rows
      .filter((row) => row.aggregateId !== undefined)
      .map((row) => toDomain(row));
  },

  async findByOwnerAndName(
    ownerId: OwnerId,
    name: string,
  ): Promise<PersonalCategory | null> {
    const row = await ctx.db
      .query("categories")
      .withIndex("by_user_name", (q) =>
        q.eq("userId", ownerId as unknown as Id<"users">).eq("name", name),
      )
      .first();
    return row ? toDomain(row) : null;
  },
});

import {
  Goal,
  type GoalId,
  type GoalRepository,
  type GoalState,
  type MemberId,
  toGoalId,
  toMemberId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// Driven adapter for the GoalRepository port over `ctx.db` (the `goals` table). Field-for-field;
// no FK resolution is needed (a Goal only references its owning member). The row<->aggregate
// translation is inline here because it is trivial.
export const convexGoalRepository = (ctx: MutationCtx): GoalRepository => {
  const rowById = (id: GoalId): Promise<Doc<"goals"> | null> =>
    ctx.db
      .query("goals")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  const toDomain = (row: Doc<"goals">): Goal => {
    const state: GoalState = {
      id: toGoalId(row.aggregateId as string),
      userId: toMemberId(row.userId as unknown as string),
      title: row.title,
      description: row.description,
      targetCompletions: row.targetCompletions,
      currentCompletions: row.currentCompletions,
      targetDate:
        row.targetDate === undefined ? undefined : new Date(row.targetDate),
      isActive: row.isActive,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
    return Goal.rehydrate(state);
  };

  const toRow = (goal: Goal): Omit<Doc<"goals">, "_id" | "_creationTime"> => {
    const state = goal.toState();
    return {
      aggregateId: state.id as string,
      userId: state.userId as unknown as Id<"users">,
      title: state.title,
      description: state.description,
      targetCompletions: state.targetCompletions,
      currentCompletions: state.currentCompletions,
      targetDate: state.targetDate?.getTime(),
      isActive: state.isActive,
      createdAt: state.createdAt.getTime(),
      updatedAt: state.updatedAt.getTime(),
    };
  };

  return {
    async findById(id: GoalId): Promise<Goal | null> {
      const row = await rowById(id);
      return row ? toDomain(row) : null;
    },

    async save(goal: Goal): Promise<void> {
      const row = toRow(goal);
      const existing = await rowById(goal.id);
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("goals", row);
    },

    async listByUser(userId: MemberId): Promise<readonly Goal[]> {
      const rows = await ctx.db
        .query("goals")
        .withIndex("by_user", (q) =>
          q.eq("userId", userId as unknown as Id<"users">),
        )
        .collect();
      // Only domain-written rows (legacy rows lack an aggregateId) participate in the new path.
      return rows
        .filter((row) => row.aggregateId !== undefined)
        .map((row) => toDomain(row));
    },
  };
};

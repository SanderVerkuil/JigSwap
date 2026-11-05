import { Goal, GoalId, MemberId } from "../../../domain";

// Outbound port: persistence for the Goal aggregate. The 2c-convex adapter implements this over
// `ctx.db` (the `goals` table) behind a mapper; the domain never sees a row.
export interface GoalRepository {
  findById(id: GoalId): Promise<Goal | null>;
  save(goal: Goal): Promise<void>;
  listByUser(userId: MemberId): Promise<readonly Goal[]>;
  // Hard-delete a goal by its domain id. No-op if the goal is already gone.
  delete(id: GoalId): Promise<void>;
}

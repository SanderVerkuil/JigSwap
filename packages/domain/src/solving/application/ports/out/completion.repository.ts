import { Completion, CompletionId, GoalSolve, MemberId } from "../../../domain";

// Outbound port: persistence for the Completion aggregate. The 2c-convex adapter implements this
// over `ctx.db` (the `completions` table) behind a mapper; the domain never sees a row.
export interface CompletionRepository {
  findById(id: CompletionId): Promise<Completion | null>;
  save(completion: Completion): Promise<void>;
  listByUser(userId: MemberId): Promise<readonly Completion[]>;
  // Every FINISHED solve of the member (end instant + date precision), including legacy rows the
  // domain path does not otherwise load. Each goal counts the ones inside its own period
  // (countTowardGoal), so this drives the DERIVED goal progress and the count is never hand-set.
  listGoalSolves(userId: MemberId): Promise<readonly GoalSolve[]>;
  // Hard-delete a completion by its domain id. No-op if the completion is already gone.
  delete(id: CompletionId): Promise<void>;
}

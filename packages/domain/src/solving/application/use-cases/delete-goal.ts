import { err, ok } from "../../../shared-kernel";
import { DeleteGoal, DeleteGoalCommand } from "../ports/in/delete-goal.port";
import { GoalRepository } from "../ports/out/goal.repository";
import { loadOwnedGoal } from "./owned-goal";

export interface DeleteGoalDeps {
  readonly goals: GoalRepository;
}

// Transaction script: load the acting member's own goal (GoalNotFound / NotGoalOwner) and delete
// it for good. Nothing else references a goal's progress; a goal_achieved notification about it
// simply resolves as unavailable afterwards.
export const makeDeleteGoal =
  (deps: DeleteGoalDeps): DeleteGoal =>
  async (cmd: DeleteGoalCommand) => {
    const goal = await loadOwnedGoal(
      deps.goals,
      cmd.goalId,
      cmd.actingMemberId,
    );
    if (goal.isErr) return err(goal.error);

    await deps.goals.delete(goal.value.id);
    return ok(undefined);
  };

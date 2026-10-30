import { Clock, err, ok } from "../../../shared-kernel";
import { UpdateGoal, UpdateGoalCommand } from "../ports/in/update-goal.port";
import { CompletionRepository } from "../ports/out/completion.repository";
import { GoalRepository } from "../ports/out/goal.repository";
import { loadOwnedGoal } from "./owned-goal";

export interface UpdateGoalDeps {
  readonly goals: GoalRepository;
  readonly completions: CompletionRepository;
  readonly clock: Clock;
}

// Transaction script: load the acting member's own goal (GoalNotFound / NotGoalOwner), replace its
// definition (InvalidGoalTarget / InvalidGoalPeriod), recount it SILENTLY for the new period, and
// persist. Publishes nothing: editing a goal never announces an achievement.
export const makeUpdateGoal =
  (deps: UpdateGoalDeps): UpdateGoal =>
  async (cmd: UpdateGoalCommand) => {
    const goal = await loadOwnedGoal(
      deps.goals,
      cmd.goalId,
      cmd.actingMemberId,
    );
    if (goal.isErr) return err(goal.error);

    const now = deps.clock.now();
    const outcome = goal.value.edit(
      {
        title: cmd.title,
        description: cmd.description,
        targetCompletions: cmd.targetCompletions,
        startDate: cmd.startDate,
        targetDate: cmd.targetDate,
      },
      now,
    );
    if (outcome.isErr) return err(outcome.error);

    goal.value.recount(
      await deps.completions.listGoalSolves(goal.value.userId),
      now,
    );
    await deps.goals.save(goal.value);
    return ok(undefined);
  };

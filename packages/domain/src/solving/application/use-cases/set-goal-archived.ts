import { Clock, err, ok } from "../../../shared-kernel";
import {
  SetGoalArchived,
  SetGoalArchivedCommand,
} from "../ports/in/set-goal-archived.port";
import { CompletionRepository } from "../ports/out/completion.repository";
import { GoalRepository } from "../ports/out/goal.repository";
import { loadOwnedGoal } from "./owned-goal";

export interface SetGoalArchivedDeps {
  readonly goals: GoalRepository;
  readonly completions: CompletionRepository;
  readonly clock: Clock;
}

// Transaction script: load the acting member's own goal (GoalNotFound / NotGoalOwner), then archive
// it (it stops following new solves) or restore it and recount it SILENTLY for the solves it
// missed while archived. Persists; publishes nothing.
export const makeSetGoalArchived =
  (deps: SetGoalArchivedDeps): SetGoalArchived =>
  async (cmd: SetGoalArchivedCommand) => {
    const goal = await loadOwnedGoal(
      deps.goals,
      cmd.goalId,
      cmd.actingMemberId,
    );
    if (goal.isErr) return err(goal.error);

    const now = deps.clock.now();
    if (cmd.archived) {
      goal.value.archive(now);
    } else {
      goal.value.restore(now);
      goal.value.recount(
        await deps.completions.listGoalSolves(goal.value.userId),
        now,
      );
    }
    await deps.goals.save(goal.value);
    return ok(undefined);
  };

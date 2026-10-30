import { Clock, DomainEventPublisher, ok } from "../../../shared-kernel";
import {
  RecomputeGoalProgress,
  RecomputeGoalProgressCommand,
} from "../ports/in/recompute-goal-progress.port";
import { CompletionRepository } from "../ports/out/completion.repository";
import { GoalRepository } from "../ports/out/goal.repository";

export interface RecomputeGoalProgressDeps {
  readonly goals: GoalRepository;
  readonly completions: CompletionRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script driven by a completion being recorded, edited or deleted: read the member's
// finished solves once and let each ACTIVE goal count the ones inside its own period (the count is
// never hand-set — it is always derived here). Each goal emits GoalProgressed on a change and
// GoalAchieved once on the crossing. Publishes the union of every touched goal's events.
export const makeRecomputeGoalProgress =
  (deps: RecomputeGoalProgressDeps): RecomputeGoalProgress =>
  async (cmd: RecomputeGoalProgressCommand) => {
    const solves = await deps.completions.listGoalSolves(cmd.userId);
    const goals = await deps.goals.listByUser(cmd.userId);

    const now = deps.clock.now();
    for (const goal of goals) {
      if (!goal.isActive) continue;
      goal.progressFrom(solves, now);

      const events = goal.pullEvents();
      if (events.length > 0) {
        await deps.goals.save(goal);
        await deps.events.publish(events);
      }
    }
    return ok(undefined);
  };

import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
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

// Transaction script driven by CompletionRecorded: read the AUTHORITATIVE completion count for
// the member and push it into each of their active goals (the count is never hand-set — it is
// always derived here). Each goal emits GoalProgressed on a change and GoalAchieved once on the
// crossing. Publishes the union of every touched goal's events.
export const makeRecomputeGoalProgress =
  (deps: RecomputeGoalProgressDeps): RecomputeGoalProgress =>
  async (cmd: RecomputeGoalProgressCommand) => {
    const count = await deps.completions.countCompletedByUser(cmd.userId);
    const goals = await deps.goals.listByUser(cmd.userId);

    const now = deps.clock.now();
    for (const goal of goals) {
      if (!goal.isActive) continue;
      const outcome = goal.progressTo(count, now);
      if (outcome.isErr) return err(outcome.error);

      const events = goal.pullEvents();
      if (events.length > 0) {
        await deps.goals.save(goal);
        await deps.events.publish(events);
      }
    }
    return ok(undefined);
  };

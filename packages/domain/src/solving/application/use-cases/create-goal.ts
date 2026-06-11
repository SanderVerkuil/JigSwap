import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Goal } from "../../domain";
import { CreateGoal, CreateGoalCommand } from "../ports/in/create-goal.port";
import { GoalRepository } from "../ports/out/goal.repository";
import { GoalIdGenerator } from "../ports/out/id-generators";

export interface CreateGoalDeps {
  readonly goals: GoalRepository;
  readonly ids: GoalIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: mint a Goal (validates a positive target), persist, publish GoalCreated.
export const makeCreateGoal =
  (deps: CreateGoalDeps): CreateGoal =>
  async (cmd: CreateGoalCommand) => {
    const goal = Goal.create({
      id: deps.ids.next(),
      userId: cmd.userId,
      title: cmd.title,
      description: cmd.description,
      targetCompletions: cmd.targetCompletions,
      targetDate: cmd.targetDate,
      now: deps.clock.now(),
    });
    if (goal.isErr) return err(goal.error);

    await deps.goals.save(goal.value);
    await deps.events.publish(goal.value.pullEvents());
    return ok(goal.value.id);
  };

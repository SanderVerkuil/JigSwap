import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Goal } from "../../domain";
import { CreateGoal, CreateGoalCommand } from "../ports/in/create-goal.port";
import { CompletionRepository } from "../ports/out/completion.repository";
import { GoalRepository } from "../ports/out/goal.repository";
import { GoalIdGenerator } from "../ports/out/id-generators";

export interface CreateGoalDeps {
  readonly goals: GoalRepository;
  readonly completions: CompletionRepository;
  readonly ids: GoalIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: mint a Goal (validates a positive target and a non-empty period), count the
// member's solves already inside its period SILENTLY (a goal that is met the moment it is set
// announces no achievement), persist, publish GoalCreated.
export const makeCreateGoal =
  (deps: CreateGoalDeps): CreateGoal =>
  async (cmd: CreateGoalCommand) => {
    const now = deps.clock.now();
    const goal = Goal.create({
      id: deps.ids.next(),
      userId: cmd.userId,
      title: cmd.title,
      description: cmd.description,
      targetCompletions: cmd.targetCompletions,
      startDate: cmd.startDate,
      targetDate: cmd.targetDate,
      now,
    });
    if (goal.isErr) return err(goal.error);

    goal.value.recount(await deps.completions.listGoalSolves(cmd.userId), now);
    await deps.goals.save(goal.value);
    await deps.events.publish(goal.value.pullEvents());
    return ok(goal.value.id);
  };

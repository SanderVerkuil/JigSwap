import { toCompletionId, toGoalId } from "../../../shared-kernel";
import { CompletionId, GoalId } from "../../domain";
import {
  CompletionIdGenerator,
  GoalIdGenerator,
} from "../ports/out/id-generators";

// Deterministic id generators for tests: completion-1, goal-1, ...
export class SequentialCompletionIdGenerator implements CompletionIdGenerator {
  private counter = 0;

  next(): CompletionId {
    this.counter += 1;
    return toCompletionId(`completion-${this.counter}`);
  }
}

export class SequentialGoalIdGenerator implements GoalIdGenerator {
  private counter = 0;

  next(): GoalId {
    this.counter += 1;
    return toGoalId(`goal-${this.counter}`);
  }
}

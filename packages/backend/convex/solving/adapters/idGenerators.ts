import {
  type CompletionId,
  type CompletionIdGenerator,
  type GoalId,
  type GoalIdGenerator,
  toCompletionId,
  toGoalId,
} from "@jigswap/domain";

// Driven adapters for the Solving id-generator ports. crypto.randomUUID is available in the
// Convex runtime; the values are branded and persisted as each aggregate's `aggregateId`.
export const completionIdGenerator: CompletionIdGenerator = {
  next: (): CompletionId => toCompletionId(crypto.randomUUID()),
};

export const goalIdGenerator: GoalIdGenerator = {
  next: (): GoalId => toGoalId(crypto.randomUUID()),
};

import {
  type DomainEvent,
  type MemberId,
  makeRecomputeGoalProgress,
  type SolvingDomainEvent,
} from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { convexCompletionRepository } from "./convexCompletionRepository";
import { convexGoalRepository } from "./convexGoalRepository";
import { systemClock } from "./systemClock";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. Handlers run
// SYNCHRONOUSLY inside the same Convex transaction, preserving atomicity. WHY in-process: durable
// /async fan-out (an events table + scheduler dispatch) is a deliberate later enhancement.
//
// WHY the goal-progress reaction lives here: a Goal's progress is DERIVED from the member's
// completion count, so recording a completion must immediately recompute their goals — wiring it
// to CompletionRecorded keeps that recompute in the SAME transaction (no stale progress, no extra
// round-trip). It reacts ONLY to CompletionRecorded, so the GoalProgressed/GoalAchieved events
// the recompute itself publishes can never re-trigger it (no recursion).
export const inProcessEventPublisher = (
  ctx: MutationCtx,
): { publish(events: readonly DomainEvent[]): Promise<void> } => ({
  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events as readonly SolvingDomainEvent[]) {
      switch (event.name) {
        case "CompletionRecorded":
          await recomputeGoals(ctx, event.userId);
          break;
        // CompletionStarted/CompletionEdited/PuzzleReviewed/GoalCreated/GoalProgressed/
        // GoalAchieved are consumed by Insights/Social/Notifications in later phases; no
        // in-process side effect in this slice, so they are intentionally dropped here.
        default:
          break;
      }
    }
  },
});

// Recompute the member's derived goal progress from their authoritative completion count. Uses a
// publisher that ignores CompletionRecorded (only the goal repos/clock are wired here), so the
// recompute can never recurse back into itself.
const recomputeGoals = async (
  ctx: MutationCtx,
  userId: MemberId,
): Promise<void> => {
  const recompute = makeRecomputeGoalProgress({
    goals: convexGoalRepository(ctx),
    completions: convexCompletionRepository(ctx),
    events: inProcessEventPublisher(ctx),
    clock: systemClock,
  });
  await recompute({ userId });
};

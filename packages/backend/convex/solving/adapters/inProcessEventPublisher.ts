import {
  makeRecomputeGoalProgress,
  type DomainEventPublisher,
  type MemberId,
  type SolvingDomainEvent,
} from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { makeEventPublisher } from "../../events/makeEventPublisher";
import { convexCompletionRepository } from "./convexCompletionRepository";
import { convexGoalRepository } from "./convexGoalRepository";
import { systemClock } from "./systemClock";

// Driven adapter for the DomainEventPublisher port, built per-mutation with `ctx`. It now durably
// records + schedules ALL solving events (so e.g. GoalAchieved reaches the async Notifications
// subscriber) while KEEPING the one CRITICAL reaction inline.
//
// WHY the goal-progress reaction stays SYNC: a Goal's progress is DERIVED from the member's
// finished solves inside the goal's period, so recording, editing (a changed end date can move a
// solve into or out of a period) or deleting a completion must immediately recompute their goals
// in the SAME transaction (no stale progress, no extra round-trip). Each member is recomputed once
// per published batch. It reacts ONLY to completion events, so the GoalProgressed/GoalAchieved
// events the recompute itself publishes never re-trigger it (no recursion) — and because those
// events flow through this same publisher, they are recorded + scheduled too, finally landing the
// goal-achievement notification.
export const inProcessEventPublisher = (
  ctx: MutationCtx,
): DomainEventPublisher =>
  makeEventPublisher(ctx, "solving", async (events) => {
    const members = new Set<MemberId>();
    for (const event of events as readonly SolvingDomainEvent[]) {
      if (
        event.name === "CompletionRecorded" ||
        event.name === "CompletionEdited" ||
        event.name === "CompletionDeleted"
      ) {
        members.add(event.userId);
      }
    }
    for (const userId of members) await recomputeGoals(ctx, userId);
  });

// Recompute the member's derived goal progress from their finished solves. Reuses
// THIS publisher so the recompute's own events (GoalProgressed/GoalAchieved) are durably recorded
// + scheduled; the sync handler ignores those names, so the recompute can never recurse.
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

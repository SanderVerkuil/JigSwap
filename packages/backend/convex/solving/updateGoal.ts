import { makeUpdateGoal, toGoalId, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { convexGoalRepository } from "./adapters/convexGoalRepository";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for editing a goal: authenticate (acting member from auth, never from args) ->
// wire adapters -> call the use case, which refuses another member's goal (NotGoalOwner) or a
// missing one (GoalNotFound), validates the target and period, and recounts progress silently.
// The whole definition is replaced: an omitted description, startDate or targetDate is cleared.
// `goalId` is the goal's aggregateId; dates are calendar dates as UTC-midnight ms.
export const updateGoal = mutation({
  args: {
    goalId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    targetCompletions: v.number(),
    startDate: v.optional(v.number()),
    targetDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actingMemberId = await requireMember(ctx);

    const update = makeUpdateGoal({
      goals: convexGoalRepository(ctx),
      completions: convexCompletionRepository(ctx),
      clock: systemClock,
    });
    const result = await update({
      actingMemberId: actingMemberId as unknown as MemberId,
      goalId: toGoalId(args.goalId),
      title: args.title,
      description: args.description,
      targetCompletions: args.targetCompletions,
      startDate:
        args.startDate === undefined ? undefined : new Date(args.startDate),
      targetDate:
        args.targetDate === undefined ? undefined : new Date(args.targetDate),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

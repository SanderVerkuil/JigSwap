import { makeSetGoalArchived, toGoalId, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { convexGoalRepository } from "./adapters/convexGoalRepository";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for archiving (archived: true) or restoring (archived: false) a goal:
// authenticate -> wire adapters -> call the use case, which refuses another member's goal
// (NotGoalOwner) or a missing one (GoalNotFound). An archived goal stops following new solves; a
// restored one is recounted silently. `goalId` is the goal's aggregateId.
export const setGoalArchived = mutation({
  args: {
    goalId: v.string(),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actingMemberId = await requireMember(ctx);

    const setArchived = makeSetGoalArchived({
      goals: convexGoalRepository(ctx),
      completions: convexCompletionRepository(ctx),
      clock: systemClock,
    });
    const result = await setArchived({
      actingMemberId: actingMemberId as unknown as MemberId,
      goalId: toGoalId(args.goalId),
      archived: args.archived,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

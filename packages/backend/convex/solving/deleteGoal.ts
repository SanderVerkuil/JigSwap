import { makeDeleteGoal, toGoalId, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexGoalRepository } from "./adapters/convexGoalRepository";
import { toConvexError } from "./errors";

// Composition root for deleting a goal for good: authenticate -> call the use case, which refuses
// another member's goal (NotGoalOwner) or a missing one (GoalNotFound). A goal_achieved
// notification that pointed at it resolves as unavailable afterwards
// (notifications/resolveNotificationView). `goalId` is the goal's aggregateId.
export const deleteGoal = mutation({
  args: {
    goalId: v.string(),
  },
  handler: async (ctx, args) => {
    const actingMemberId = await requireMember(ctx);

    const remove = makeDeleteGoal({ goals: convexGoalRepository(ctx) });
    const result = await remove({
      actingMemberId: actingMemberId as unknown as MemberId,
      goalId: toGoalId(args.goalId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

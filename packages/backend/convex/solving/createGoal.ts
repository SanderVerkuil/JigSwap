import { makeCreateGoal, type MemberId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexGoalRepository } from "./adapters/convexGoalRepository";
import { goalIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for creating a completion-count goal: authenticate (owner from auth) -> wire
// adapters -> call the use case (validates a positive target -> GoalCreated) -> return the new
// GoalId (aggregateId).
export const createGoal = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    targetCompletions: v.number(),
    targetDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireMember(ctx);

    const create = makeCreateGoal({
      goals: convexGoalRepository(ctx),
      ids: goalIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await create({
      userId: userId as unknown as MemberId,
      title: args.title,
      description: args.description,
      targetCompletions: args.targetCompletions,
      targetDate:
        args.targetDate === undefined ? undefined : new Date(args.targetDate),
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});

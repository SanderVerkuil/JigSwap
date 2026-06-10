import {
  makeFinishCompletion,
  type MemberId,
  toCompletionId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for finishing an in-progress completion: authenticate -> wire adapters -> call
// the use case (loads, checks ownership, finishes -> CompletionRecorded -> goal-progress recompute
// via the publisher) -> map result.
export const finishCompletion = mutation({
  args: {
    completionId: v.string(),
    endDate: v.number(),
    completionTimeMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actingMemberId = await requireMember(ctx);

    const finish = makeFinishCompletion({
      completions: convexCompletionRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await finish({
      actingMemberId: actingMemberId as unknown as MemberId,
      completionId: toCompletionId(args.completionId),
      endDate: new Date(args.endDate),
      completionTimeMinutes: args.completionTimeMinutes,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

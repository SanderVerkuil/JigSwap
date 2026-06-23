import {
  makeDeleteCompletion,
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

// Composition root for deleting a completion the acting member owns. No edit-window restriction —
// a member may delete their own completion at any time (e.g. logged by accident). Ownership is
// enforced in the use case; deletion triggers an in-process goal recompute in the same transaction.
export const deleteCompletion = mutation({
  args: {
    completionId: v.string(),
  },
  handler: async (ctx, args) => {
    const actingMemberId = await requireMember(ctx);

    const del = makeDeleteCompletion({
      completions: convexCompletionRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await del({
      actingMemberId: actingMemberId as unknown as MemberId,
      completionId: toCompletionId(args.completionId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

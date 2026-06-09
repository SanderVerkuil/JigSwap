import {
  type CompletionId,
  type FileId,
  makeEditCompletion,
  type MemberId,
  toId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for editing a completion's mutable fields: authenticate -> wire adapters ->
// call the use case. Ownership and the 24h edit window (EditWindowClosed) are enforced by the
// aggregate. An undefined field leaves the current value untouched.
export const editCompletion = mutation({
  args: {
    completionId: v.string(),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    completionTimeMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actingMemberId = await requireMember(ctx);

    const edit = makeEditCompletion({
      completions: convexCompletionRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await edit({
      actingMemberId: actingMemberId as unknown as MemberId,
      completionId: toId<"CompletionId">(args.completionId) as CompletionId,
      notes: args.notes,
      photoFileIds: args.photos?.map((id) => toId<"FileId">(id) as FileId),
      startDate:
        args.startDate === undefined ? undefined : new Date(args.startDate),
      endDate: args.endDate === undefined ? undefined : new Date(args.endDate),
      completionTimeMinutes: args.completionTimeMinutes,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

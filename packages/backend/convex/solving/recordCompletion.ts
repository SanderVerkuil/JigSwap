import {
  makeRecordCompletion,
  makeStartCompletion,
  type MemberId,
  toCopyId,
  toFileId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { completionIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for logging a solve: authenticate (owner from auth) -> wire adapters -> call
// the use case -> return the new CompletionId (aggregateId). When `endDate` is supplied the solve
// is logged already-finished (RecordCompletion, which fires CompletionRecorded and drives goal
// progress); otherwise an in-progress solve is started (StartCompletion). Puzzle references in
// args are domain aggregateIds (strings); the repository resolves them to real FK document ids.
export const recordCompletion = mutation({
  args: {
    puzzleDefinitionId: v.optional(v.string()),
    copyId: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    completionTimeMinutes: v.optional(v.number()),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireMember(ctx);

    // Logging a solve is an OWNER-ONLY action on one's OWN copy. The domain use cases never load
    // the Copy, so without this gate any authenticated user could inject fabricated completions
    // (with ratings/notes) onto another member's copy — getCopyInstanceView surfaces ALL of a
    // copy's completions. Mirror shareCopyToCircle/setCopyCover: resolve the copy by its
    // aggregateId (the Library CopyId) and require the actor to be its owner.
    if (args.copyId !== undefined) {
      const copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.copyId))
        .unique();
      if (!copy) throw new ConvexError("Copy not found");
      if (copy.ownerId !== (userId as unknown as string)) {
        throw new ConvexError("Only the owner can log a solve for this copy");
      }
    }

    const puzzleDefinitionId = args.puzzleDefinitionId
      ? toPuzzleDefinitionId(args.puzzleDefinitionId)
      : undefined;
    const copyId = args.copyId ? toCopyId(args.copyId) : undefined;
    const photoFileIds = args.photos?.map((id) => toFileId(id));

    // No end instant => start an in-progress solve; an end instant => log a finished one.
    if (args.endDate === undefined) {
      const start = makeStartCompletion({
        completions: convexCompletionRepository(ctx),
        ids: completionIdGenerator,
        events: inProcessEventPublisher(ctx),
        clock: systemClock,
      });
      const result = await start({
        userId: userId as unknown as MemberId,
        puzzleDefinitionId,
        copyId,
        startDate: new Date(args.startDate),
        notes: args.notes,
        photoFileIds,
      });
      if (result.isErr) throw toConvexError(result.error);
      return result.value as string;
    }

    const record = makeRecordCompletion({
      completions: convexCompletionRepository(ctx),
      ids: completionIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await record({
      userId: userId as unknown as MemberId,
      puzzleDefinitionId,
      copyId,
      startDate: new Date(args.startDate),
      endDate: new Date(args.endDate),
      completionTimeMinutes: args.completionTimeMinutes,
      notes: args.notes,
      photoFileIds,
    });
    if (result.isErr) throw toConvexError(result.error);
    return result.value as string;
  },
});

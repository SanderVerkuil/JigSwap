import {
  makeRecordCompletion,
  makeStartCompletion,
  type MemberId,
  toCopyId,
  toFileId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { v } from "convex/values";
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

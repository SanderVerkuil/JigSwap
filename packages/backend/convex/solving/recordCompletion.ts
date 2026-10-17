import {
  makeRecordCompletion,
  makeStartCompletion,
  toCopyId,
  toPuzzleDefinitionId,
  type MemberId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { completionIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { denormalizeCopyOntoCompletion } from "./copySnapshot";
import { toConvexError } from "./errors";
import { loadSolvableCopy } from "./solvableCopy";

// Composition root for logging a solve. Either a copy or a puzzle definition (or both) may be
// referenced; the puzzle definition is always persisted as the durable anchor (derived from the
// copy when only a copy is given). Logging a copy's solve is allowed for the OWNER or the current
// HOLDER (borrower); everyone else is rejected. After the use case persists, the copy's state is
// denormalized onto the row as a durable snapshot.
//
// Date precision (spec 2026-10-17 §3.2): "day" (the default) needs `startDate`, and `endDate` for
// a finished solve (without `endDate` it starts an in-progress solve). "year" needs `year`;
// "unknown" takes no date. Both record a FINISHED solve whose sentinel dates the domain computes,
// so `startDate`/`endDate`/`completionTimeMinutes` must be absent for them.
export const recordCompletion = mutation({
  args: {
    puzzleDefinitionId: v.optional(v.string()),
    copyId: v.optional(v.string()),
    datePrecision: v.optional(
      v.union(v.literal("day"), v.literal("year"), v.literal("unknown")),
    ),
    year: v.optional(v.number()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    completionTimeMinutes: v.optional(v.number()),
    notes: v.optional(v.string()),
    allPiecesPresent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireMember(ctx);
    const me = userId as unknown as string;

    // Resolve + authorize the copy once (owner, current holder or household); reused for the
    // snapshot.
    let copy: Doc<"ownedPuzzles"> | null = null;
    if (args.copyId !== undefined) {
      copy = await loadSolvableCopy(ctx, me as Id<"users">, args.copyId);
    }
    const datePrecision = args.datePrecision ?? "day";
    // A dated solve always names its start; only a dated solve can be in progress.
    if (datePrecision === "day" && args.startDate === undefined) {
      throw new ConvexError({
        code: "InvalidDatePrecision",
        message: "A dated solve needs a start date",
      });
    }

    const puzzleDefinitionId = args.puzzleDefinitionId
      ? toPuzzleDefinitionId(args.puzzleDefinitionId)
      : undefined;
    const copyId = args.copyId ? toCopyId(args.copyId) : undefined;

    let completionId: string;
    if (datePrecision === "day" && args.endDate === undefined) {
      // Event-payload asymmetry: this path passes puzzleDefinitionId as given (undefined when only
      // a copy is supplied), while startCompletion derives it from the copy. Rows converge via the
      // snapshot denormalization below; only the CompletionStarted event payload differs.
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
        startDate: new Date(args.startDate as number),
        notes: args.notes,
        allPiecesPresent: args.allPiecesPresent,
      });
      if (result.isErr) throw toConvexError(result.error);
      completionId = result.value as string;
    } else {
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
        datePrecision,
        startDate:
          args.startDate === undefined ? undefined : new Date(args.startDate),
        endDate:
          args.endDate === undefined ? undefined : new Date(args.endDate),
        year: args.year,
        completionTimeMinutes: args.completionTimeMinutes,
        notes: args.notes,
        allPiecesPresent: args.allPiecesPresent,
      });
      if (result.isErr) throw toConvexError(result.error);
      completionId = result.value as string;
    }

    if (copy) {
      await denormalizeCopyOntoCompletion(
        ctx,
        completionId,
        copy,
        args.copyId as string,
        me,
      );
    }

    // `completionId` stays the domain AGGREGATE id (photo attach and downstream flows key on it
    // via by_aggregate_id); `puzzleId`/`copyId` are the resolved Convex doc `_id`s from the
    // persisted row, for callers that need the review targets.
    const row = await ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
      .unique();
    return {
      completionId,
      puzzleId: row?.puzzleId ?? null,
      copyId: row?.ownedPuzzleId ?? null,
    };
  },
});

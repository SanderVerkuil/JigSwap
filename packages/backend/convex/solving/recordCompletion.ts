import {
  makeRecordCompletion,
  makeStartCompletion,
  type MemberId,
  toCopyId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { completionIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { denormalizeCopyOntoCompletion } from "./copySnapshot";
import { toConvexError } from "./errors";

// Composition root for logging a solve. Either a copy or a puzzle definition (or both) may be
// referenced; the puzzle definition is always persisted as the durable anchor (derived from the
// copy when only a copy is given). Logging a copy's solve is allowed for the OWNER or the current
// HOLDER (borrower); everyone else is rejected. After the use case persists, the copy's state is
// denormalized onto the row as a durable snapshot.
export const recordCompletion = mutation({
  args: {
    puzzleDefinitionId: v.optional(v.string()),
    copyId: v.optional(v.string()),
    startDate: v.number(),
    endDate: v.optional(v.number()),
    completionTimeMinutes: v.optional(v.number()),
    notes: v.optional(v.string()),
    allPiecesPresent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireMember(ctx);
    const me = userId as unknown as string;

    // Resolve + authorize the copy once (owner OR current holder); reused for the snapshot.
    let copy: Doc<"ownedPuzzles"> | null = null;
    if (args.copyId !== undefined) {
      copy = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.copyId))
        .unique();
      if (!copy) throw new ConvexError("Copy not found");
      if (copy.ownerId !== me && copy.heldBy !== me) {
        throw new ConvexError(
          "Only the owner or current holder can log a solve for this copy",
        );
      }
    }

    const puzzleDefinitionId = args.puzzleDefinitionId
      ? toPuzzleDefinitionId(args.puzzleDefinitionId)
      : undefined;
    const copyId = args.copyId ? toCopyId(args.copyId) : undefined;

    let completionId: string;
    if (args.endDate === undefined) {
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
        startDate: new Date(args.startDate),
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
        startDate: new Date(args.startDate),
        endDate: new Date(args.endDate),
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

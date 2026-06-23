import {
  makeRecordCompletion,
  makeStartCompletion,
  type MemberId,
  toCopyId,
  toFileId,
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
    photos: v.optional(v.array(v.string())),
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
    const photoFileIds = args.photos?.map((id) => toFileId(id));

    let completionId: string;
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
        photoFileIds,
        allPiecesPresent: args.allPiecesPresent,
      });
      if (result.isErr) throw toConvexError(result.error);
      completionId = result.value as string;
    }

    // Denormalize the durable puzzleId anchor + copy snapshot onto the just-written row.
    if (copy) {
      const row = await ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", completionId))
        .unique();
      if (row) {
        await ctx.db.patch(row._id, {
          puzzleId: row.puzzleId ?? copy.puzzleId,
          copySnapshot: {
            copyId: args.copyId as string,
            ownerId: copy.ownerId,
            wasBorrowed: copy.ownerId !== me,
            condition: copy.condition,
            missingPiecesCount: copy.missingPiecesCount,
            title: copy.snapshot?.title,
            brand: copy.snapshot?.brand,
            pieceCount: copy.snapshot?.pieceCount,
          },
        });
      }
    }

    return completionId;
  },
});

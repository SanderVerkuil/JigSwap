import {
  makeStartCompletion,
  type MemberId,
  toCopyId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { copyAccessOf } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { completionIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { denormalizeCopyOntoCompletion } from "./copySnapshot";
import { toConvexError } from "./errors";

// Composition root for the first-class "Start puzzle" action: mint an in-progress completion
// against a copy (owner or current holder only), then denormalize the copy snapshot exactly like
// recordCompletion so downstream views have a durable title source. Publishes CompletionStarted.
export const startCompletion = mutation({
  args: {
    copyId: v.string(),
    startDate: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireMember(ctx);
    const me = userId as unknown as string;

    const copy = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", args.copyId))
      .unique();
    if (!copy) throw new ConvexError("Copy not found");
    // Owner, current holder, or any household member (view or manage): the solve is the logger's
    // own — completions are personal and never shared with the household.
    if (
      copy.ownerId !== me &&
      copy.heldBy !== me &&
      (await copyAccessOf(ctx, me as Id<"users">, copy)) === "none"
    ) {
      throw new ConvexError(
        "Only the owner, current holder or a household member can log a solve for this copy",
      );
    }

    const startUseCase = makeStartCompletion({
      completions: convexCompletionRepository(ctx),
      ids: completionIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await startUseCase({
      userId: userId as unknown as MemberId,
      puzzleDefinitionId: copy.puzzleDefinitionId
        ? toPuzzleDefinitionId(copy.puzzleDefinitionId)
        : undefined,
      copyId: toCopyId(args.copyId),
      startDate: new Date(args.startDate),
      notes: args.notes,
    });
    if (result.isErr) throw toConvexError(result.error);

    await denormalizeCopyOntoCompletion(
      ctx,
      result.value as string,
      copy,
      args.copyId,
      me,
    );
    return result.value as string;
  },
});

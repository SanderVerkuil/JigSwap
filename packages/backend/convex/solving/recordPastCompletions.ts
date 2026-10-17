import { makeRecordCompletion, toCopyId, type MemberId } from "@jigswap/domain";
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

// The most solves one call may log (the quick start's "Did you finish any of these?" list).
export const MAX_PAST_COMPLETIONS = 25;

// The bulk "I've solved these" path (spec 2026-10-17 §2.4 step 2, §4). Logs FINISHED solves of
// copies, one per item, with the precision the member chose: a picked date ("day", stored as a
// same-day solve), a year, or "I don't remember" ("unknown"). It never fakes a date and asks for no
// time, photos or reviews.
//
// - Authz: the same copy gate as recordCompletion (owner, current holder or household member),
//   checked for EVERY copy before anything is written.
// - All or nothing: one mutation is one transaction, so any refused item rolls back the batch.
// - No feed flood: every CompletionRecorded is marked `bulk`, and the feed skips bulk solves, so
//   even a batch of picked dates doesn't announce 25 solves to followers.
export const recordPastCompletions = mutation({
  args: {
    items: v.array(
      v.object({
        copyId: v.string(),
        datePrecision: v.union(
          v.literal("day"),
          v.literal("year"),
          v.literal("unknown"),
        ),
        // Epoch ms of the picked day; required iff "day".
        date: v.optional(v.number()),
        // Required iff "year".
        year: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ completionIds: string[] }> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    if (args.items.length === 0 || args.items.length > MAX_PAST_COMPLETIONS) {
      throw new ConvexError({
        code: "InvalidBatchSize",
        message: `Log between 1 and ${MAX_PAST_COMPLETIONS} solves at once`,
      });
    }
    if (new Set(args.items.map((i) => i.copyId)).size !== args.items.length) {
      throw new ConvexError({
        code: "DuplicateCopy",
        message: "Each copy can appear only once in a batch",
      });
    }

    // Gate every copy first, so a refusal never leaves a half-written batch behind.
    const copies: Doc<"ownedPuzzles">[] = [];
    for (const item of args.items) {
      copies.push(await loadSolvableCopy(ctx, me, item.copyId));
    }

    const record = makeRecordCompletion({
      completions: convexCompletionRepository(ctx),
      ids: completionIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const completionIds: string[] = [];
    for (const [index, item] of args.items.entries()) {
      const day = item.date === undefined ? undefined : new Date(item.date);
      const result = await record({
        userId: me as unknown as MemberId,
        copyId: toCopyId(item.copyId),
        datePrecision: item.datePrecision,
        startDate: day,
        endDate: day,
        year: item.year,
        bulk: true,
      });
      if (result.isErr) throw toConvexError(result.error);
      const completionId = result.value as string;
      await denormalizeCopyOntoCompletion(
        ctx,
        completionId,
        copies[index] as Doc<"ownedPuzzles">,
        item.copyId,
        me as string,
      );
      completionIds.push(completionId);
    }
    return { completionIds };
  },
});

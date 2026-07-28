import {
  makeUpsertCopyReview,
  makeUpsertPuzzleReview,
  toCopyId,
  toMemberId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  convexCopyReviewRepository,
  convexPuzzleReviewRepository,
} from "./adapters/convexReviewRepositories";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for the two-level review form: upsert the caller's puzzle review and/or
// star-only copy review in ONE mutation (one Convex transaction). The branded ids handed to the
// domain CARRY Convex doc `_id`s (the postPuzzleReview.ts idiom — the adapters cast back, no
// resolution). The copy-review permission facts (owner? completion on the copy?) are looked up
// HERE and passed on the command; the domain decides.
export const submitReviews = mutation({
  args: {
    puzzleId: v.id("puzzles"),
    copyId: v.optional(v.id("ownedPuzzles")),
    puzzle: v.optional(
      v.object({ rating: v.number(), text: v.optional(v.string()) }),
    ),
    copy: v.optional(v.object({ rating: v.number() })),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    if (args.puzzle === undefined && args.copy === undefined) {
      throw new ConvexError(
        "At least one of a puzzle or copy review is required",
      );
    }
    if (args.copy !== undefined && args.copyId === undefined) {
      throw new ConvexError("A copy review requires a copyId");
    }

    // Resolve the copy + permission facts once, before any write.
    let copyOwnerId: Id<"users"> | undefined;
    let hasCompletionOnCopy = false;
    if (args.copy !== undefined) {
      const copyId = args.copyId as Id<"ownedPuzzles">;
      const copy = await ctx.db.get(copyId);
      if (!copy) throw new ConvexError("Copy not found");
      if (copy.puzzleId !== args.puzzleId) {
        throw new ConvexError("Copy does not belong to this puzzle");
      }
      copyOwnerId = copy.ownerId;
      hasCompletionOnCopy =
        (await ctx.db
          .query("completions")
          .withIndex("by_user_owned_puzzle", (q) =>
            q.eq("userId", userId).eq("ownedPuzzleId", copyId),
          )
          .first()) !== null;
    }

    if (args.puzzle !== undefined) {
      const upsertPuzzleReviewUseCase = makeUpsertPuzzleReview({
        puzzleReviews: convexPuzzleReviewRepository(ctx),
        events: inProcessEventPublisher(ctx),
        clock: systemClock,
      });
      const result = await upsertPuzzleReviewUseCase({
        actingMemberId: memberId,
        puzzleId: toPuzzleDefinitionId(args.puzzleId as unknown as string),
        rating: args.puzzle.rating,
        text: args.puzzle.text,
      });
      if (result.isErr) throw toConvexError(result.error);
    }

    if (args.copy !== undefined) {
      const upsertCopyReviewUseCase = makeUpsertCopyReview({
        copyReviews: convexCopyReviewRepository(ctx),
        events: inProcessEventPublisher(ctx),
        clock: systemClock,
      });
      const result = await upsertCopyReviewUseCase({
        actingMemberId: memberId,
        copyId: toCopyId(args.copyId as unknown as string),
        copyOwnerId: toMemberId(copyOwnerId as unknown as string),
        hasCompletionOnCopy,
        rating: args.copy.rating,
      });
      if (result.isErr) throw toConvexError(result.error);
    }
  },
});

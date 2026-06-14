import {
  makePostComment,
  type MemberId,
  type PuzzleDefinitionId,
  toMemberId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCommentRepository } from "./adapters/convexCommentRepository";
import { commentIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for posting a community review on the catalog puzzle DEFINITION. Identical to
// postPuzzleComment but keyed by puzzleId directly: the catalog detail page has no copyId to resolve
// through. Reuses the SAME post-comment domain use case + `puzzleComments` table + repository; the
// non-empty-text / rating-1-5 validation stays in the Comment aggregate. The author is derived from
// auth, never the client.
export const postPuzzleReview = mutation({
  args: {
    puzzleId: v.id("puzzles"),
    text: v.string(),
    rating: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const authorId = (await requireMember(ctx)) as unknown as MemberId;

    const post = makePostComment({
      comments: convexCommentRepository(ctx),
      commentIds: commentIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await post({
      authorId: toMemberId(authorId as unknown as string),
      // Carry the catalog puzzle's Convex id as the PuzzleDefinitionId (the mapper re-brands it to
      // the `puzzles` FK column on save).
      puzzleId: toPuzzleDefinitionId(
        args.puzzleId as unknown as string,
      ) as PuzzleDefinitionId,
      text: args.text,
      rating: args.rating,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

import {
  makePostComment,
  type MemberId,
  type PuzzleDefinitionId,
  toMemberId,
  toPuzzleDefinitionId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCommentRepository } from "./adapters/convexCommentRepository";
import { commentIdGenerator } from "./adapters/idGenerators";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root for posting a community comment. The API is keyed by COPY id for the UI's
// convenience, but a comment belongs to the puzzle DEFINITION (shared across every copy of it), so
// we resolve copy -> copy.puzzleId before running the use case. The author is derived from auth; the
// aggregate validates the text/rating.
export const postPuzzleComment = mutation({
  args: {
    copyId: v.id("ownedPuzzles"),
    text: v.string(),
    rating: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const authorId = (await requireMember(ctx)) as unknown as MemberId;

    const copy = await ctx.db.get(args.copyId);
    if (!copy) throw new ConvexError("Copy not found");

    const post = makePostComment({
      comments: convexCommentRepository(ctx),
      commentIds: commentIdGenerator,
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });

    const result = await post({
      authorId: toMemberId(authorId as unknown as string),
      // The Comment attaches to the catalog puzzle the copy instantiates; carry its Convex id as the
      // PuzzleDefinitionId (the mapper re-brands it to the `puzzles` FK column on save).
      puzzleId: toPuzzleDefinitionId(
        copy.puzzleId as unknown as string,
      ) as PuzzleDefinitionId,
      text: args.text,
      rating: args.rating,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

import {
  type CopyId,
  makePostComment,
  type MemberId,
  type PuzzleDefinitionId,
  toCopyId,
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

// Composition root for posting a COPY-scoped comment. Keyed by copy id: the comment is scoped to
// that single owned copy (the owner's notes/rating), so we carry the copyId through AND resolve
// copy -> copy.puzzleId for context. Copy-scoped comments are listed only on that copy and are
// excluded from the puzzle definition's community reviews/rating. The author is derived from auth;
// the aggregate validates the text/rating.
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
      // Scope the comment to this owned copy so it shows only on the copy page, not as a community
      // review of the shared definition.
      copyId: toCopyId(args.copyId as unknown as string) as CopyId,
      text: args.text,
      rating: args.rating,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

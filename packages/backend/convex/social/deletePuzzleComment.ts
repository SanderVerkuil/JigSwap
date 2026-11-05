import { makeDeleteComment, toCommentId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCommentRepository } from "./adapters/convexCommentRepository";
import { toConvexError } from "./errors";

// Composition root for deleting a copy comment (SEC-70). `commentId` is the `id` the read side
// shows (listPuzzleComments: the aggregateId, else a legacy row's `_id`). The actor comes from
// auth, never the client; the use case lets only the comment's author delete it (NotCommentAuthor)
// and answers CommentNotFound for an unknown id. The row is deleted outright.
export const deletePuzzleComment = mutation({
  args: { commentId: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireMember(ctx);

    const deleteCommentUseCase = makeDeleteComment({
      comments: convexCommentRepository(ctx),
    });
    const result = await deleteCommentUseCase({
      commentId: toCommentId(args.commentId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

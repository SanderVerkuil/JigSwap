import { makeDeletePhotoComment, toPhotoCommentId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexPhotoCommentRepository } from "../social/adapters/convexPhotoCommentRepository";
import { toConvexError } from "../social/errors";

// Composition root for deleting a photo comment (SEC-70). `commentId` is the `id` the read side
// shows (listPhotoComments: the aggregateId, else a legacy row's `_id`). The actor comes from
// auth, never the client; the use case lets only the comment's author delete it (NotCommentAuthor)
// — not the photo's owner — and answers CommentNotFound for an unknown id. The author may delete
// it even when the photo's copy is no longer visible to them. The row is deleted outright.
export const deletePhotoComment = mutation({
  args: { commentId: v.string() },
  handler: async (ctx, args) => {
    const actorId = await requireMember(ctx);

    const deletePhotoCommentUseCase = makeDeletePhotoComment({
      comments: convexPhotoCommentRepository(ctx),
    });
    const result = await deletePhotoCommentUseCase({
      commentId: toPhotoCommentId(args.commentId),
      actorId,
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

import { err, ok, Result } from "../../../shared-kernel";
import { SocialApplicationError } from "../errors";
import {
  DeleteComment,
  DeleteCommentCommand,
} from "../ports/in/delete-comment.port";
import { CommentRepository } from "../ports/out/comment.repository";

export interface DeleteCommentDeps {
  readonly comments: CommentRepository;
}

// A member may delete a comment they wrote, and only that: the comment is loaded by id, its
// author must be the actor, and then it is removed outright (no tombstone — the text is the
// member's personal data). Nothing subscribes to a deletion, so no event is published.
export const makeDeleteComment =
  (deps: DeleteCommentDeps): DeleteComment =>
  async (
    cmd: DeleteCommentCommand,
  ): Promise<Result<void, SocialApplicationError>> => {
    const comment = await deps.comments.findById(cmd.commentId);
    if (!comment) return err(SocialApplicationError.commentNotFound());
    if (comment.authorId !== cmd.actorId) {
      return err(SocialApplicationError.notCommentAuthor());
    }
    await deps.comments.remove(comment);
    return ok(undefined);
  };

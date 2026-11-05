import { err, ok, Result } from "../../../shared-kernel";
import { SocialApplicationError } from "../errors";
import {
  DeletePhotoComment,
  DeletePhotoCommentCommand,
} from "../ports/in/delete-photo-comment.port";
import { PhotoCommentRepository } from "../ports/out/photo-comment.repository";

export interface DeletePhotoCommentDeps {
  readonly comments: PhotoCommentRepository;
}

// A member may delete a photo comment they wrote, and only that: the comment is loaded by id, its
// author must be the actor, and then it is removed outright (no tombstone — the text is the
// member's personal data). Nothing subscribes to a deletion, so no event is published.
export const makeDeletePhotoComment =
  (deps: DeletePhotoCommentDeps): DeletePhotoComment =>
  async (
    cmd: DeletePhotoCommentCommand,
  ): Promise<Result<void, SocialApplicationError>> => {
    const comment = await deps.comments.findById(cmd.commentId);
    if (!comment) return err(SocialApplicationError.commentNotFound());
    if (comment.authorId !== cmd.actorId) {
      return err(SocialApplicationError.notCommentAuthor());
    }
    await deps.comments.remove(comment);
    return ok(undefined);
  };

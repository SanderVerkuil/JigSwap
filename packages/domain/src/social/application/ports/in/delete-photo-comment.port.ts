import { Result } from "../../../../shared-kernel";
import { MemberId, PhotoCommentId } from "../../../domain";
import { SocialApplicationError } from "../../errors";

// The command to delete a photo comment. `actorId` is resolved from auth by the transport adapter
// and must be the comment's author.
export interface DeletePhotoCommentCommand {
  readonly commentId: PhotoCommentId;
  readonly actorId: MemberId;
}

// Inbound port: the delete-photo-comment use case. Fails with CommentNotFound when there is no such
// photo comment and NotCommentAuthor when the actor did not write it.
export interface DeletePhotoComment {
  (
    cmd: DeletePhotoCommentCommand,
  ): Promise<Result<void, SocialApplicationError>>;
}

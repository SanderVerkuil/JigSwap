import { Result } from "../../../../shared-kernel";
import { CommentId, MemberId } from "../../../domain";
import { SocialApplicationError } from "../../errors";

// The command to delete a comment. `actorId` is resolved from auth by the transport adapter and
// must be the comment's author.
export interface DeleteCommentCommand {
  readonly commentId: CommentId;
  readonly actorId: MemberId;
}

// Inbound port: the delete-comment use case. Fails with CommentNotFound when there is no such
// comment and NotCommentAuthor when the actor did not write it.
export interface DeleteComment {
  (cmd: DeleteCommentCommand): Promise<Result<void, SocialApplicationError>>;
}

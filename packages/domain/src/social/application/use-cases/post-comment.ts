import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { Comment, CommentId, SocialError } from "../../domain";
import { PostComment, PostCommentCommand } from "../ports/in/post-comment.port";
import { CommentRepository } from "../ports/out/comment.repository";
import { CommentIdGenerator } from "../ports/out/id-generators";

export interface PostCommentDeps {
  readonly comments: CommentRepository;
  readonly commentIds: CommentIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: mint a CommentId, delegate the text/rating validation to Comment.post, save,
// then publish CommentPosted. There is no cross-aggregate rule (comments are append-only and may
// repeat), so every decision lives in the aggregate; the use case only wires id + clock + I/O.
export const makePostComment =
  (deps: PostCommentDeps): PostComment =>
  async (cmd: PostCommentCommand): Promise<Result<CommentId, SocialError>> => {
    const comment = Comment.post({
      id: deps.commentIds.next(),
      puzzleId: cmd.puzzleId,
      authorId: cmd.authorId,
      text: cmd.text,
      rating: cmd.rating,
      now: deps.clock.now(),
    });
    if (comment.isErr) return err(comment.error);

    await deps.comments.save(comment.value);
    await deps.events.publish(comment.value.pullEvents());

    return ok(comment.value.id);
  };

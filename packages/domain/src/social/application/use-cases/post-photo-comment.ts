import {
  Clock,
  DomainEventPublisher,
  err,
  ok,
  Result,
} from "../../../shared-kernel";
import { PhotoComment, PhotoCommentId, SocialError } from "../../domain";
import {
  PostPhotoComment,
  PostPhotoCommentCommand,
} from "../ports/in/post-photo-comment.port";
import { PhotoCommentIdGenerator } from "../ports/out/id-generators";
import { PhotoCommentRepository } from "../ports/out/photo-comment.repository";

export interface PostPhotoCommentDeps {
  readonly comments: PhotoCommentRepository;
  readonly commentIds: PhotoCommentIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: mint a PhotoCommentId, delegate the text validation to PhotoComment.post,
// save, then publish PhotoCommentPosted. There is no cross-aggregate rule (photo comments are
// append-only and may repeat), so every decision lives in the aggregate; the use case only wires
// id + clock + I/O.
export const makePostPhotoComment =
  (deps: PostPhotoCommentDeps): PostPhotoComment =>
  async (
    cmd: PostPhotoCommentCommand,
  ): Promise<Result<PhotoCommentId, SocialError>> => {
    const comment = PhotoComment.post({
      id: deps.commentIds.next(),
      photoId: cmd.photoId,
      authorId: cmd.authorId,
      text: cmd.text,
      now: deps.clock.now(),
    });
    if (comment.isErr) return err(comment.error);

    await deps.comments.save(comment.value);
    await deps.events.publish(comment.value.pullEvents());

    return ok(comment.value.id);
  };

import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { CommentText } from "./comment-text";
import { SocialError } from "./errors";
import { PhotoCommentPosted } from "./events";
import { MemberId, PhotoCommentId, PhotoId } from "./ids";

// Input to post(): the comment's identity, the PHOTO it is attached to, its author, the
// still-unvalidated text, and the instant it was posted. A photo comment attaches to ONE specific
// uploaded photo (an `ownedPuzzleImages` row), so the lightbox for that photo shows its own thread.
// Unlike a community Comment there is no rating — a photo comment is plain discussion text.
export interface PostPhotoCommentProps {
  readonly id: PhotoCommentId;
  readonly photoId: PhotoId;
  readonly authorId: MemberId;
  readonly text: string;
  readonly now: Date;
}

// The persistable shape of a photo comment, kept close to a `photoComments` table so the mapper is a
// trivial field-for-field translation (value object <-> primitive).
export interface PhotoCommentState {
  readonly id: PhotoCommentId;
  readonly photoId: PhotoId;
  readonly authorId: MemberId;
  readonly text: CommentText;
  readonly createdAt: Date;
}

// PhotoComment: a lightweight discussion aggregate posted against a single shared PHOTO. Created via
// post(), which validates the only invariant decidable from its own data — non-empty text (reusing
// the CommentText value object). Records PhotoCommentPosted on creation so subscribers can react.
// A deliberate sibling of Comment rather than a reuse: Comment's subject id is a PuzzleDefinitionId
// baked into its state/event/mapper, whereas a PhotoComment is keyed to a PhotoId and carries no
// rating, so a separate small aggregate keeps both honest.
export class PhotoComment {
  private events: DomainEvent[] = [];

  private constructor(private readonly state: PhotoCommentState) {}

  get id(): PhotoCommentId {
    return this.state.id;
  }

  get photoId(): PhotoId {
    return this.state.photoId;
  }

  get authorId(): MemberId {
    return this.state.authorId;
  }

  get text(): CommentText {
    return this.state.text;
  }

  get createdAt(): Date {
    return this.state.createdAt;
  }

  // Post a brand-new photo comment. Validates the text (non-empty after trim); failure fails the
  // whole post. Records PhotoCommentPosted on success.
  static post(props: PostPhotoCommentProps): Result<PhotoComment, SocialError> {
    const text = CommentText.create(props.text);
    if (text.isErr) return err(text.error);

    const comment = new PhotoComment({
      id: props.id,
      photoId: props.photoId,
      authorId: props.authorId,
      text: text.value,
      createdAt: props.now,
    });
    comment.record(
      new PhotoCommentPosted(
        props.id,
        props.photoId,
        props.authorId,
        text.value.value,
        props.now,
      ),
    );
    return ok(comment);
  }

  // Drain recorded events for the publisher; clears the buffer so a save can't double-emit.
  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  // Map to/from persistence without the aggregate knowing about any storage technology.
  static rehydrate(state: PhotoCommentState): PhotoComment {
    return new PhotoComment(state);
  }

  toState(): PhotoCommentState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}

import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { CommentRating } from "./comment-rating";
import { CommentText } from "./comment-text";
import { SocialError } from "./errors";
import { CommentPosted } from "./events";
import { CommentId, MemberId, PuzzleDefinitionId } from "./ids";

// Input to post(): the comment's identity, the puzzle DEFINITION it is attached to, its author, the
// still-unvalidated text, an optional rating, and the instant it was posted. A comment is attached
// to the puzzle definition (not a single owned copy) so every copy of that puzzle shows the same
// community discussion.
export interface PostCommentProps {
  readonly id: CommentId;
  readonly puzzleId: PuzzleDefinitionId;
  readonly authorId: MemberId;
  readonly text: string;
  readonly rating?: number;
  readonly now: Date;
}

// The persistable shape of a community comment, kept close to a `puzzleComments` table so the
// mapper is a trivial field-for-field translation (value objects <-> primitives).
export interface CommentState {
  readonly id: CommentId;
  readonly puzzleId: PuzzleDefinitionId;
  readonly authorId: MemberId;
  readonly text: CommentText;
  readonly rating?: CommentRating;
  readonly createdAt: Date;
}

// Comment: a lightweight community-discussion aggregate posted against a puzzle DEFINITION. Created
// via post(), which validates the only invariants decidable from its own data — non-empty text and
// (if present) an integer 1–5 rating. Records CommentPosted on creation so subscribers can react.
export class Comment {
  private events: DomainEvent[] = [];

  private constructor(private readonly state: CommentState) {}

  get id(): CommentId {
    return this.state.id;
  }

  get puzzleId(): PuzzleDefinitionId {
    return this.state.puzzleId;
  }

  get authorId(): MemberId {
    return this.state.authorId;
  }

  get text(): CommentText {
    return this.state.text;
  }

  get rating(): CommentRating | undefined {
    return this.state.rating;
  }

  get createdAt(): Date {
    return this.state.createdAt;
  }

  // Post a brand-new comment. Validates the text (non-empty after trim) and, when supplied, the
  // rating (integer 1–5); either failure fails the whole post. Records CommentPosted on success.
  static post(props: PostCommentProps): Result<Comment, SocialError> {
    const text = CommentText.create(props.text);
    if (text.isErr) return err(text.error);

    let rating: CommentRating | undefined;
    if (props.rating !== undefined) {
      const parsed = CommentRating.create(props.rating);
      if (parsed.isErr) return err(parsed.error);
      rating = parsed.value;
    }

    const comment = new Comment({
      id: props.id,
      puzzleId: props.puzzleId,
      authorId: props.authorId,
      text: text.value,
      rating,
      createdAt: props.now,
    });
    comment.record(
      new CommentPosted(
        props.id,
        props.puzzleId,
        props.authorId,
        text.value.value,
        rating ? rating.value : null,
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
  static rehydrate(state: CommentState): Comment {
    return new Comment(state);
  }

  toState(): CommentState {
    return this.state;
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}

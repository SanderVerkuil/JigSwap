import { err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";

// The longest comment a member may post, in UTF-16 code units (what a browser's maxLength counts),
// measured after trimming. Shared by photo comments and copy comments.
export const COMMENT_TEXT_MAX_LENGTH = 1000;

// The body of a community comment as an immutable value object validated at construction. The raw
// input is trimmed; an empty/whitespace-only body is rejected with EmptyCommentText and one longer
// than COMMENT_TEXT_MAX_LENGTH with CommentTextTooLong. We store the trimmed form so a Comment
// never holds incidental leading/trailing whitespace.
export class CommentText {
  private constructor(readonly value: string) {}

  static create(value: string): Result<CommentText, SocialError> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return err(SocialError.emptyCommentText());
    }
    if (trimmed.length > COMMENT_TEXT_MAX_LENGTH) {
      return err(SocialError.commentTextTooLong(COMMENT_TEXT_MAX_LENGTH));
    }
    return ok(new CommentText(trimmed));
  }

  // Rehydrate a persisted value that was already validated when first stored. Never re-validates,
  // so a comment stored before the length cap still loads.
  static fromState(value: string): CommentText {
    return new CommentText(value);
  }
}

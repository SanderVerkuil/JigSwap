import { err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";

// The body of a community comment as an immutable value object validated at construction. The raw
// input is trimmed; an empty/whitespace-only body is rejected with EmptyCommentText. We store the
// trimmed form so a Comment never holds incidental leading/trailing whitespace.
export class CommentText {
  private constructor(readonly value: string) {}

  static create(value: string): Result<CommentText, SocialError> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return err(SocialError.emptyCommentText());
    }
    return ok(new CommentText(trimmed));
  }

  // Rehydrate a persisted value that was already validated when first stored.
  static fromState(value: string): CommentText {
    return new CommentText(value);
  }
}

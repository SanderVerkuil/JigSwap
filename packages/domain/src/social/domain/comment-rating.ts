import { err, ok, Result } from "../../shared-kernel";
import { SocialError } from "./errors";

// The lowest and highest stars a member may attach to a community comment.
const MIN_STARS = 1;
const MAX_STARS = 5;

// An optional 1–5 star rating value object for a community Comment. Declared independently of
// Solving's StarRating (the boundary passes primitives, so the two structurally identical classes
// never cross) so Social validates its own input without depending on another context.
export class CommentRating {
  private constructor(readonly value: number) {}

  static create(value: number): Result<CommentRating, SocialError> {
    if (!Number.isInteger(value) || value < MIN_STARS || value > MAX_STARS) {
      return err(SocialError.invalidCommentRating(value));
    }
    return ok(new CommentRating(value));
  }

  // Rehydrate a persisted value that was already validated when first stored.
  static fromState(value: number): CommentRating {
    return new CommentRating(value);
  }

  equals(other: CommentRating): boolean {
    return this.value === other.value;
  }
}

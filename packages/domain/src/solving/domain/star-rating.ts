import { err, ok, Result } from "../../shared-kernel";
import { SolvingError } from "./errors";

// The lowest and highest stars a member may award a puzzle.
const MIN_STARS = 1;
const MAX_STARS = 5;

// A 1–5 star rating value object, reused by PuzzleReview. A rating is the member's opinion of
// the PUZZLE (difficulty/quality), not of a trading partner — see the §1.5 homonym table.
export class StarRating {
  private constructor(readonly value: number) {}

  static create(value: number): Result<StarRating, SolvingError> {
    if (!Number.isInteger(value) || value < MIN_STARS || value > MAX_STARS) {
      return err(SolvingError.invalidRating(value));
    }
    return ok(new StarRating(value));
  }

  // Rehydrate a persisted value that was already validated when first stored.
  static fromState(value: number): StarRating {
    return new StarRating(value);
  }

  equals(other: StarRating): boolean {
    return this.value === other.value;
  }
}

import { err, ok, Result } from "../../shared-kernel";
import { ReputationError } from "./errors";

// A 1-5 star rating as an immutable value object validated at construction. Only integers in
// the inclusive [1, 5] range are valid; 0 and 6 (and fractional values) are rejected with
// InvalidRating. (Solving will declare its own StarRating locally; barrel disambiguation
// handles the name at integration.)
export class StarRating {
  private constructor(readonly value: number) {}

  static create(value: number): Result<StarRating, ReputationError> {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return err(ReputationError.invalidRating(value));
    }
    return ok(new StarRating(value));
  }
}

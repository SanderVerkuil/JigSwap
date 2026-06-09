import { err, ok, Result } from "../../shared-kernel";
import { SolvingError } from "./errors";

const MS_PER_MINUTE = 60_000;

// A solve duration measured in whole positive minutes (mirrors the persisted
// `completions.completionTimeMinutes`). A value object so the "positive minutes" invariant
// lives in one place and a Completion never holds a negative or fractional duration.
export class SolveDuration {
  private constructor(readonly minutes: number) {}

  static ofMinutes(minutes: number): Result<SolveDuration, SolvingError> {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return err(SolvingError.invalidDuration());
    }
    return ok(new SolveDuration(Math.round(minutes)));
  }

  // Derive a duration from a start/end pair (end must be on or after start). A zero-length span
  // is not a valid solve, so equal instants are rejected as an invalid duration.
  static between(start: Date, end: Date): Result<SolveDuration, SolvingError> {
    const ms = end.getTime() - start.getTime();
    if (ms <= 0) return err(SolvingError.invalidDuration());
    return SolveDuration.ofMinutes(ms / MS_PER_MINUTE);
  }

  // Rehydrate a persisted value that was already validated when first stored.
  static fromState(minutes: number): SolveDuration {
    return new SolveDuration(minutes);
  }

  equals(other: SolveDuration): boolean {
    return this.minutes === other.minutes;
  }
}

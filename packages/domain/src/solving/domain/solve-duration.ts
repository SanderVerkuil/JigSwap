import { err, ok, Result } from "../../shared-kernel";
import { SolvingError } from "./errors";

const MS_PER_MINUTE = 60_000;

// A solve duration measured in whole positive minutes (mirrors the persisted
// `completions.completionTimeMinutes`). A value object so the "positive minutes" invariant
// lives in one place and a Completion never holds a negative or fractional duration.
export class SolveDuration {
  private constructor(readonly minutes: number) {}

  static ofMinutes(minutes: number): Result<SolveDuration, SolvingError> {
    if (!Number.isFinite(minutes)) {
      return err(SolvingError.invalidDuration());
    }
    // Round FIRST, then validate the rounded value — a sub-30-second span must be rejected, never
    // silently stored as 0 (which would violate the positive-minutes invariant).
    const rounded = Math.round(minutes);
    if (rounded <= 0) {
      return err(SolvingError.invalidDuration());
    }
    return ok(new SolveDuration(rounded));
  }

  // Derive a duration from a start/end pair (end must be on or after start). A zero-length (or
  // negative) span isn't a valid solve; ofMinutes rejects it since it rounds to <= 0 minutes.
  static between(start: Date, end: Date): Result<SolveDuration, SolvingError> {
    const ms = end.getTime() - start.getTime();
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

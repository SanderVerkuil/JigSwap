import { err, ok, Result } from "../../shared-kernel";
import { SolvingError } from "./errors";

const MS_PER_MINUTE = 60_000;

// The longest a solve can be said to have taken: ten years. Whatever a member states is stored and
// feeds the averages on a definition's public page, so one number must not be able to swamp them.
export const MAX_SOLVE_MINUTES = 10 * 365 * 1440;

// Whether a stored number can be a solve's duration. For reads that aggregate stored rows, which
// may predate MAX_SOLVE_MINUTES: a row that fails it counts as a solve with no known duration.
export const isPlausibleSolveMinutes = (
  minutes: number | undefined,
): minutes is number =>
  minutes !== undefined &&
  Number.isFinite(minutes) &&
  minutes > 0 &&
  minutes <= MAX_SOLVE_MINUTES;

// Whether start and end are further apart than any solve time. Such dates can be true (a puzzle
// found again years later), so the solve keeps them, without a duration (Completion.resolveDuration).
export const isSpanLongerThanAnySolve = (start: Date, end: Date): boolean =>
  (end.getTime() - start.getTime()) / MS_PER_MINUTE > MAX_SOLVE_MINUTES;

// A solve duration measured in whole positive minutes, at most MAX_SOLVE_MINUTES (mirrors the
// persisted `completions.completionTimeMinutes`). A value object so the invariant lives in one place
// and a Completion never holds a negative, fractional or absurd duration.
export class SolveDuration {
  private constructor(readonly minutes: number) {}

  static ofMinutes(minutes: number): Result<SolveDuration, SolvingError> {
    if (!Number.isFinite(minutes)) {
      return err(SolvingError.invalidDuration());
    }
    // Round FIRST, then validate the rounded value — a sub-30-second span must be rejected, never
    // silently stored as 0 (which would violate the positive-minutes invariant).
    const rounded = Math.round(minutes);
    if (rounded <= 0 || rounded > MAX_SOLVE_MINUTES) {
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

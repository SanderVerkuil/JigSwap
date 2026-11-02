// How precisely a finished solve is dated (spec 2026-10-17 §3.2, user decision 3). "day" is a real
// date (the default, and what every legacy row is); "year" is "sometime in 2023"; "unknown" is
// "I finished it, I don't remember when". Year-only and undated solves are stored as FINISHED
// completions with sentinel dates (see yearSentinel and Completion.record), so the in-progress
// invariant ("isCompleted = false, no endDate") is untouched. No consumer infers the precision
// from the dates: each one reads this field.
export type DatePrecision = "day" | "year" | "unknown";

// The earliest year a year-only solve may claim.
export const MIN_SOLVE_YEAR = 1900;

const EARLIEST_SOLVE = Date.UTC(MIN_SOLVE_YEAR, 0, 1);
const LATEST_SOLVE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

// A date a solve can have: a real date from MIN_SOLVE_YEAR on, and at most a year ahead (the forms
// don't refuse a date ahead of today, and a member's today can be ahead of UTC's). Whatever else
// arrives (NaN, Infinity and far-off instants all do through new Date) must never be stored: other
// members read it back.
export const isPossibleSolveDate = (date: Date, now: Date): boolean => {
  const at = date.getTime();
  return at >= EARLIEST_SOLVE && at <= now.getTime() + LATEST_SOLVE_AHEAD_MS;
};

// Goals count dated and year-only solves, never undated ones (user decision 4).
export const countsTowardGoals = (precision: DatePrecision): boolean =>
  precision !== "unknown";

// The stored instant for a year-only solve: 1 July at UTC noon, which lies inside that year in
// every timezone, capped at `now` so a current-year solve is never in the future.
export const yearSentinel = (year: number, now: Date): Date =>
  new Date(Math.min(Date.UTC(year, 6, 1, 12), now.getTime()));

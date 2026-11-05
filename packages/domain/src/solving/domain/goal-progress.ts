import { countsTowardGoals, DatePrecision } from "./date-precision";

const DAY_MS = 24 * 60 * 60 * 1000;

// A finished solve as goal counting sees it: the instant it was finished and how precisely that
// instant is known ("year" and "unknown" solves hold sentinel instants, see yearSentinel).
export interface GoalSolve {
  readonly endDate: Date;
  readonly datePrecision: DatePrecision;
}

// The span a goal counts solves in: from `from` (inclusive) to `toExclusive` (exclusive), both UTC
// midnights. No `toExclusive` means open-ended (a goal without a target date).
export interface GoalWindow {
  readonly from: Date;
  readonly toExclusive?: Date;
}

// The goal fields that decide its window. Calendar dates are stored as UTC midnight (the web's
// date-input convention), which is why every boundary here is a UTC day.
export interface GoalPeriod {
  readonly startDate?: Date;
  readonly createdAt: Date;
  readonly targetDate?: Date;
}

const utcDayStart = (at: Date): number =>
  Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());

// A goal counts from the UTC day of its start date (or, for goals without one, the day it was
// created) through the whole UTC day of its target date.
export const goalCountingWindow = (period: GoalPeriod): GoalWindow => {
  const from = new Date(utcDayStart(period.startDate ?? period.createdAt));
  if (period.targetDate === undefined) return { from };
  return {
    from,
    toExclusive: new Date(utcDayStart(period.targetDate) + DAY_MS),
  };
};

// Does the span [start, endExclusive) share at least one instant with the window?
const overlaps = (
  start: number,
  endExclusive: number,
  window: GoalWindow,
): boolean =>
  endExclusive > window.from.getTime() &&
  (window.toExclusive === undefined || start < window.toExclusive.getTime());

// Whether one finished solve counts toward a goal with this window (decision 4, made period-aware):
// - "day": its end instant lies inside the window;
// - "year": its calendar year (UTC) overlaps the window, so a "solved in 2026" import counts toward
//   any goal that covers part of 2026 and never toward a goal that lies wholly in another year;
// - "unknown": never.
export const countsTowardGoal = (
  solve: GoalSolve,
  window: GoalWindow,
): boolean => {
  if (!countsTowardGoals(solve.datePrecision)) return false;
  if (solve.datePrecision === "year") {
    const year = solve.endDate.getUTCFullYear();
    return overlaps(Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1), window);
  }
  const at = solve.endDate.getTime();
  return overlaps(at, at + 1, window);
};

// The number of a member's finished solves that count toward a goal with this window.
export const countTowardGoal = (
  solves: readonly GoalSolve[],
  window: GoalWindow,
): number => solves.filter((solve) => countsTowardGoal(solve, window)).length;

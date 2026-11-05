// Completions grouped per calendar month for a trend chart. Pure and deterministic: the caller
// passes the completion timestamps and the "now" reference so the 12-month window is testable
// without touching the system clock.

import { DEFAULT_WINDOW_MONTHS, lastMonthKeys, monthKey } from "./month-window";

export interface CompletionTrendInput {
  // Epoch milliseconds the solve finished. Only finished solves should be passed in.
  readonly completedAt: number;
  readonly completionTimeMinutes?: number;
  // Absent = "day". Year-only and undated solves have no month, so they are skipped (spec D4).
  readonly datePrecision?: "day" | "year" | "unknown";
}

export interface CompletionTrendPoint {
  // Calendar month label, "YYYY-MM" (UTC), so points sort lexicographically by chronology.
  readonly month: string;
  readonly count: number;
  readonly totalMinutes: number;
}

// Build the last `windowMonths` month buckets ending at `now` (inclusive), each pre-seeded to zero
// so a quiet month still renders as a gap in the chart rather than disappearing. Completions
// outside the window are ignored; within it they fold into their month's count + totalMinutes.
// Result is oldest→newest (the window's own order).
export const computeCompletionTrends = (
  completions: readonly CompletionTrendInput[],
  now: number = Date.now(),
  windowMonths: number = DEFAULT_WINDOW_MONTHS,
): CompletionTrendPoint[] => {
  // Seed the window so every month in range is present even with no completions.
  const buckets = new Map(
    lastMonthKeys(now, windowMonths).map((key) => [
      key,
      { count: 0, totalMinutes: 0 },
    ]),
  );

  for (const c of completions) {
    if ((c.datePrecision ?? "day") !== "day") continue;
    const key = monthKey(c.completedAt);
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the window
    bucket.count += 1;
    bucket.totalMinutes +=
      typeof c.completionTimeMinutes === "number" ? c.completionTimeMinutes : 0;
  }

  return [...buckets.entries()].map(([month, { count, totalMinutes }]) => ({
    month,
    count,
    totalMinutes,
  }));
};

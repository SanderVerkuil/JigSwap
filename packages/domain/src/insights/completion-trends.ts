// Completions grouped per calendar month for a trend chart. Pure and deterministic: the caller
// passes the completion timestamps and the "now" reference so the 12-month window is testable
// without touching the system clock.

export interface CompletionTrendInput {
  // Epoch milliseconds the solve finished. Only finished solves should be passed in.
  readonly completedAt: number;
  readonly completionTimeMinutes?: number;
}

export interface CompletionTrendPoint {
  // Calendar month label, "YYYY-MM" (UTC), so points sort lexicographically by chronology.
  readonly month: string;
  readonly count: number;
  readonly totalMinutes: number;
}

// "YYYY-MM" for an epoch-ms instant, in UTC so grouping is timezone-stable and deterministic.
const monthKey = (epochMs: number): string => {
  const d = new Date(epochMs);
  const year = d.getUTCFullYear();
  const month = `${d.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
};

// Step a {year, month} cursor back one month, normalising the January→December wrap.
const previousMonth = (
  year: number,
  month: number,
): { year: number; month: number } => {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
};

const DEFAULT_WINDOW_MONTHS = 12;

// Build the last `windowMonths` month buckets ending at `now` (inclusive), each pre-seeded to zero
// so a quiet month still renders as a gap in the chart rather than disappearing. Completions
// outside the window are ignored; within it they fold into their month's count + totalMinutes.
// Result is sorted oldest→newest.
export const computeCompletionTrends = (
  completions: readonly CompletionTrendInput[],
  now: number = Date.now(),
  windowMonths: number = DEFAULT_WINDOW_MONTHS,
): CompletionTrendPoint[] => {
  const buckets = new Map<string, { count: number; totalMinutes: number }>();

  // Seed the window so every month in range is present even with no completions.
  const nowDate = new Date(now);
  let cursor = {
    year: nowDate.getUTCFullYear(),
    month: nowDate.getUTCMonth() + 1,
  };
  for (let i = 0; i < windowMonths; i++) {
    const key = `${cursor.year}-${`${cursor.month}`.padStart(2, "0")}`;
    buckets.set(key, { count: 0, totalMinutes: 0 });
    cursor = previousMonth(cursor.year, cursor.month);
  }

  for (const c of completions) {
    const key = monthKey(c.completedAt);
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the window
    bucket.count += 1;
    bucket.totalMinutes +=
      typeof c.completionTimeMinutes === "number" ? c.completionTimeMinutes : 0;
  }

  return [...buckets.entries()]
    .map(([month, { count, totalMinutes }]) => ({ month, count, totalMinutes }))
    .sort((a, b) => a.month.localeCompare(b.month));
};

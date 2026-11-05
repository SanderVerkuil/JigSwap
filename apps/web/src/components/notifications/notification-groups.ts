import { startOfDay, startOfMonth, startOfWeek, subDays } from "date-fns";

export type RecencyBucket =
  "today" | "yesterday" | "thisWeek" | "thisMonth" | "earlier";

export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The notifications page's date sections, newest first: Today, Yesterday, This week, This month,
 * Earlier. Boundaries are local calendar days; the week starts on the locale's first day
 * (Sunday for en-US, Monday for nl). Each row lands in the first bucket whose start it is on or
 * after, so this week's days of last month stay in "This week", and a row stamped slightly ahead
 * of this device's clock counts as today. Empty buckets are left out; row order is kept.
 */
export function groupByRecency<T extends { createdAt: number }>(
  rows: readonly T[],
  now: number,
  weekStartsOn: WeekStartsOn,
): { key: RecencyBucket; rows: T[] }[] {
  const starts: [RecencyBucket, number][] = [
    ["today", startOfDay(now).getTime()],
    ["yesterday", startOfDay(subDays(now, 1)).getTime()],
    ["thisWeek", startOfWeek(now, { weekStartsOn }).getTime()],
    ["thisMonth", startOfMonth(now).getTime()],
  ];
  const buckets = new Map<RecencyBucket, T[]>();
  for (const row of rows) {
    const key =
      starts.find(([, start]) => row.createdAt >= start)?.[0] ?? "earlier";
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  const order: RecencyBucket[] = [
    "today",
    "yesterday",
    "thisWeek",
    "thisMonth",
    "earlier",
  ];
  return order.flatMap((key) => {
    const bucketRows = buckets.get(key);
    return bucketRows ? [{ key, rows: bucketRows }] : [];
  });
}

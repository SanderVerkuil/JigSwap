// The member's exchange activity, summarised two ways for charts: a count per lifecycle status, and
// a count per calendar month over the same 12-month window as the completion trends. Pure and
// total; the caller passes "now" so the window is testable without touching the system clock.

import { DEFAULT_WINDOW_MONTHS, lastMonthKeys, monthKey } from "./month-window";
import type { ExchangeStatStatus } from "./personal-stats";

export interface ExchangeActivityInput {
  readonly status: ExchangeStatStatus;
  // Epoch ms the exchange was created; used for the per-month series.
  readonly createdAt: number;
}

export interface StatusCount {
  readonly status: ExchangeStatStatus;
  readonly count: number;
}

export interface MonthCount {
  // "YYYY-MM" (UTC).
  readonly month: string;
  readonly count: number;
}

export interface TradeActivity {
  readonly total: number;
  readonly byStatus: StatusCount[];
  readonly byMonth: MonthCount[];
}

// Every lifecycle status, in a fixed presentation order, so the status chart always shows the full
// set (zeros included) and never reorders between renders.
const STATUS_ORDER: readonly ExchangeStatStatus[] = [
  "proposed",
  "accepted",
  "completed",
  "rejected",
  "cancelled",
  "disputed",
];

// Summarise exchanges by status (all statuses present, zero-filled, fixed order, all time) and by
// month: the last `windowMonths` months ending at `now`, oldest first, every month present and
// zero-filled so a quiet month shows as a gap. Exchanges created before the window still count in
// `total` and `byStatus`.
export const computeTradeActivity = (
  exchanges: readonly ExchangeActivityInput[],
  now: number = Date.now(),
  windowMonths: number = DEFAULT_WINDOW_MONTHS,
): TradeActivity => {
  const statusCounts = new Map<ExchangeStatStatus, number>(
    STATUS_ORDER.map((s) => [s, 0]),
  );
  const monthCounts = new Map(
    lastMonthKeys(now, windowMonths).map((key) => [key, 0]),
  );

  for (const ex of exchanges) {
    statusCounts.set(ex.status, (statusCounts.get(ex.status) ?? 0) + 1);
    const key = monthKey(ex.createdAt);
    const count = monthCounts.get(key);
    if (count !== undefined) monthCounts.set(key, count + 1); // else outside the window
  }

  return {
    total: exchanges.length,
    byStatus: STATUS_ORDER.map((status) => ({
      status,
      count: statusCounts.get(status) ?? 0,
    })),
    byMonth: [...monthCounts.entries()].map(([month, count]) => ({
      month,
      count,
    })),
  };
};

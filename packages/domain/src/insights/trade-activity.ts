// The member's exchange activity, summarised two ways for charts: a count per lifecycle status, and
// a count per calendar month. Pure and total.

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

const monthKey = (epochMs: number): string => {
  const d = new Date(epochMs);
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, "0")}`;
};

// Summarise exchanges by status (all statuses present, zero-filled, fixed order) and by month
// (only months with activity, sorted oldest→newest).
export const computeTradeActivity = (
  exchanges: readonly ExchangeActivityInput[],
): TradeActivity => {
  const statusCounts = new Map<ExchangeStatStatus, number>(
    STATUS_ORDER.map((s) => [s, 0]),
  );
  const monthCounts = new Map<string, number>();

  for (const ex of exchanges) {
    statusCounts.set(ex.status, (statusCounts.get(ex.status) ?? 0) + 1);
    const key = monthKey(ex.createdAt);
    monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
  }

  return {
    total: exchanges.length,
    byStatus: STATUS_ORDER.map((status) => ({
      status,
      count: statusCounts.get(status) ?? 0,
    })),
    byMonth: [...monthCounts.entries()]
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
};

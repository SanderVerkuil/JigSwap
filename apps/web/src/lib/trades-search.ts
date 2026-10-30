import type { ExchangeFields } from "@jigswap/contracts";

// /trades search params, so the view survives back/forward and can be shared as a link:
// - `exchange=<id>` (the notification deep link) opens, scrolls to and highlights that exchange. It
//   shows every exchange (no tab, no status filter), so the linked row is never filtered out.
// - `tab` picks Incoming, Outgoing or Borrowed; All is the default and carries no param.
// - `status` narrows the exchange tabs to one status (absent = every status); Borrowed has none.
// Anything else is dropped. The router merges the raw query with this result, so every key is
// returned (undefined when dropped); a missing key would let the raw value through unvalidated.

/** In lifecycle order, as the status filter lists them. */
export const EXCHANGE_STATUSES = [
  "proposed",
  "accepted",
  "completed",
  "rejected",
  "cancelled",
  "disputed",
] as const satisfies ReadonlyArray<ExchangeFields["status"]>;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

export const TRADES_TABS = ["all", "incoming", "outgoing", "borrowed"] as const;
export type TradesTab = (typeof TRADES_TABS)[number];

export interface TradesSearch {
  exchange?: string;
  tab?: Exclude<TradesTab, "all">;
  status?: ExchangeStatus;
}

const isOneOf = <T extends string>(
  values: ReadonlyArray<T>,
  value: unknown,
): value is T => values.includes(value as T);

export function validateTradesSearch(
  search: Record<string, unknown>,
): TradesSearch {
  const exchange =
    typeof search.exchange === "string" && search.exchange.trim() !== ""
      ? search.exchange
      : undefined;
  if (exchange !== undefined) {
    return { exchange, tab: undefined, status: undefined };
  }

  const tab =
    isOneOf(TRADES_TABS, search.tab) && search.tab !== "all"
      ? search.tab
      : undefined;
  const status =
    tab !== "borrowed" && isOneOf(EXCHANGE_STATUSES, search.status)
      ? search.status
      : undefined;
  return { exchange, tab, status };
}

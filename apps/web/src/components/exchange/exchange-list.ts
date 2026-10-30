import type { ExchangeStatus, TradesTab } from "@/lib/trades-search";
import type { ExchangeFields } from "@jigswap/contracts";
import { needsViewerAction, type Direction } from "./exchange-state";

// Pure list logic for the Exchanges page: which exchanges a tab and status filter show, and which
// of them wait on the viewer (listed first, under "Needs you").

type ListedFields = Pick<
  ExchangeFields,
  "status" | "initiatorConfirmationTimestamp" | "recipientConfirmationTimestamp"
>;

/** An exchange tagged with the list it came from (incoming = the viewer owns the requested copy). */
export interface ListedExchange<E extends ListedFields> {
  exchange: E;
  direction: Direction;
}

/** The rows an exchange tab shows: one direction (or both on All), optionally one status. */
export const visibleExchanges = <E extends ListedFields>(
  rows: readonly ListedExchange<E>[],
  tab: Exclude<TradesTab, "loans">,
  status?: ExchangeStatus,
): ListedExchange<E>[] =>
  rows.filter(
    ({ exchange, direction }) =>
      (tab === "all" || direction === tab) &&
      (status === undefined || exchange.status === status),
  );

/** Splits rows into those waiting on the viewer and the rest; each group keeps the given order. */
export const splitNeedsYou = <E extends ListedFields>(
  rows: readonly ListedExchange<E>[],
): { needsYou: ListedExchange<E>[]; others: ListedExchange<E>[] } => {
  const needsYou: ListedExchange<E>[] = [];
  const others: ListedExchange<E>[] = [];
  for (const row of rows) {
    (needsViewerAction(row.exchange, row.direction) ? needsYou : others).push(
      row,
    );
  }
  return { needsYou, others };
};

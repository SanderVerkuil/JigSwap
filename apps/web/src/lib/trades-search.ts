// /trades search params. `?exchange=<id>` (the notification deep link) opens, scrolls to and
// highlights that exchange; anything else is dropped.
export function validateTradesSearch(search: Record<string, unknown>): {
  exchange?: string;
} {
  return {
    exchange:
      typeof search.exchange === "string" && search.exchange.trim() !== ""
        ? search.exchange
        : undefined,
  };
}

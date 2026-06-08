// The ubiquitous language of the Exchange context. Each kind carries a distinct
// term requirement (see terms.ts):
//   - swap: puzzle-for-puzzle; the initiator must offer one of their own copies.
//   - sale: money changes hands; a price is required.
//   - lend: temporary transfer; a return date is required.
export type ExchangeKind = "swap" | "sale" | "lend";

// Legacy persisted mapping (the `exchanges.type` column uses the older vocabulary).
// The 1b adapter/mapper translates between these; the domain only speaks the new terms.
//   swap <-> "trade"
//   sale <-> "sale"
//   lend <-> "loan"
export type LegacyExchangeKind = "trade" | "sale" | "loan";

export const EXCHANGE_KINDS: readonly ExchangeKind[] = ["swap", "sale", "lend"];

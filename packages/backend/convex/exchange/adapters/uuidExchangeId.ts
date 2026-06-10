import {
  type ExchangeId,
  type ExchangeIdGenerator,
  toExchangeId,
} from "@jigswap/domain";

// Driven adapter for the ExchangeIdGenerator port. crypto.randomUUID is available in the
// Convex runtime; the value is branded as an ExchangeId and persisted as `aggregateId`.
export const uuidExchangeIdGenerator: ExchangeIdGenerator = {
  next: (): ExchangeId => toExchangeId(crypto.randomUUID()),
};

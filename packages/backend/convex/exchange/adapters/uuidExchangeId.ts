import { type ExchangeId, type ExchangeIdGenerator, toId } from "@jigswap/domain";

// Driven adapter for the ExchangeIdGenerator port. crypto.randomUUID is available in the
// Convex runtime; the value is branded as an ExchangeId and persisted as `aggregateId`.
export const uuidExchangeIdGenerator: ExchangeIdGenerator = {
  next: (): ExchangeId => toId<"ExchangeId">(crypto.randomUUID()),
};

import { ExchangeId } from "../../../domain";

// Outbound port: minting a new ExchangeId. The aggregate's `propose` takes its id as input
// (it is pure and does no I/O), so the use case obtains one here. The 1b-convex adapter can
// back this with a pre-inserted document id or a uuid.
export interface ExchangeIdGenerator {
  next(): ExchangeId;
}

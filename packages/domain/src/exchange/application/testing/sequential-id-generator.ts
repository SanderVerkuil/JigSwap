import { toId } from "../../../shared-kernel";
import { ExchangeId } from "../../domain";
import { ExchangeIdGenerator } from "../ports/out/exchange-id-generator";

// Deterministic ExchangeIdGenerator for tests: ex-1, ex-2, ...
export class SequentialIdGenerator implements ExchangeIdGenerator {
  private counter = 0;

  next(): ExchangeId {
    this.counter += 1;
    return toId<"ExchangeId">(`ex-${this.counter}`) as ExchangeId;
  }
}

import { EligibleVia } from "../../domain";
import { ExchangeEligibilityPort } from "../ports/out/exchange-eligibility.port";

// Settable ExchangeEligibilityPort: a direct route and a circle Exchange seat until a test changes
// them; `deny` takes both away.
export class FakeExchangeEligibilityPort implements ExchangeEligibilityPort {
  private via: EligibleVia | null = "direct";
  private circleSeat = true;

  deny(): this {
    this.via = null;
    this.circleSeat = false;
    return this;
  }

  allowVia(via: EligibleVia | null): this {
    this.via = via;
    return this;
  }

  withCircleSeat(held: boolean): this {
    this.circleSeat = held;
    return this;
  }

  async eligibleVia(): Promise<EligibleVia | null> {
    return this.via;
  }

  async holdsCircleExchangeSeat(): Promise<boolean> {
    return this.circleSeat;
  }
}

import { ExchangeEligibilityPort } from "../ports/out/exchange-eligibility.port";

// Settable ExchangeEligibilityPort: allows everything until a test calls `deny`.
export class FakeExchangeEligibilityPort implements ExchangeEligibilityPort {
  private allowed = true;

  deny(): this {
    this.allowed = false;
    return this;
  }

  async mayExchange(): Promise<boolean> {
    return this.allowed;
  }
}

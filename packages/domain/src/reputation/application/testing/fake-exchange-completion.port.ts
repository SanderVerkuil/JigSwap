import { ExchangeId, MemberId } from "../../domain";
import { ExchangeCompletionPort } from "../ports/out/exchange-completion.port";

// Seedable in-memory ExchangeCompletionPort. Tests register a completed exchange with its two
// parties via `seedCompleted`; `isCompletedBetween` returns true only when the exchange is
// known-completed AND the {reviewer, reviewee} pair matches its parties (order-independent).
export class FakeExchangeCompletionPort implements ExchangeCompletionPort {
  private readonly completed = new Map<ExchangeId, readonly [MemberId, MemberId]>();

  seedCompleted(exchangeId: ExchangeId, a: MemberId, b: MemberId): this {
    this.completed.set(exchangeId, [a, b]);
    return this;
  }

  async isCompletedBetween(
    exchangeId: ExchangeId,
    reviewerId: MemberId,
    revieweeId: MemberId,
  ): Promise<boolean> {
    const parties = this.completed.get(exchangeId);
    if (!parties) return false;
    const [a, b] = parties;
    return (
      (reviewerId === a && revieweeId === b) ||
      (reviewerId === b && revieweeId === a)
    );
  }
}

import type {
  ExchangeCompletionPort,
  ExchangeId,
  MemberId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// Driven adapter for the ExchangeCompletionPort: Reputation's read-only anti-corruption seam to
// Exchange. It resolves the exchange (by aggregateId, falling back to a raw `_id` for legacy
// rows) and returns true iff the exchange is `completed` AND its two parties {initiatorId,
// recipientId} are exactly {reviewerId, revieweeId} (order-independent) — i.e. the reviewer was a
// party and the reviewee the counterparty. Any other status, an unknown exchange, or a party
// mismatch yields false, which the use case maps to ExchangeNotCompleted.
export const convexExchangeCompletionPort = (
  ctx: MutationCtx,
): ExchangeCompletionPort => ({
  async isCompletedBetween(
    exchangeId: ExchangeId,
    reviewerId: MemberId,
    revieweeId: MemberId,
  ): Promise<boolean> {
    const byAggregateId = await ctx.db
      .query("exchanges")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", exchangeId as string),
      )
      .unique();
    const exchange =
      byAggregateId ??
      (await ctx.db.get(exchangeId as unknown as Id<"exchanges">));
    if (!exchange) return false;
    if (exchange.status !== "completed") return false;

    // Parties match as an unordered pair.
    const parties = new Set<string>([
      exchange.initiatorId as unknown as string,
      exchange.recipientId as unknown as string,
    ]);
    return (
      parties.size === 2 &&
      parties.has(reviewerId as unknown as string) &&
      parties.has(revieweeId as unknown as string)
    );
  },
});

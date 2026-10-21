import {
  mayExchangeVia,
  type CopyId,
  type ExchangeEligibilityPort,
  type MemberId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { exchangeRoutesFor } from "../../library/exchangeRoutes";

// Driven adapter for the ExchangeEligibilityPort: resolve the member's routes to the copy, then let
// Sharing's pure rule decide. A missing copy is not eligible (the use case reports it first anyway).
export const convexExchangeEligibility = (
  ctx: QueryCtx,
): ExchangeEligibilityPort => ({
  async mayExchange(memberId: MemberId, copyId: CopyId): Promise<boolean> {
    const copy = await ctx.db.get(copyId as unknown as Id<"ownedPuzzles">);
    if (!copy) return false;
    return mayExchangeVia(
      await exchangeRoutesFor(ctx, memberId as unknown as Id<"users">, copy),
    );
  },
});

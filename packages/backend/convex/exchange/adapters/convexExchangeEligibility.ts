import {
  exchangeAllowedVia,
  mayExchangeVia,
  type CopyId,
  type EligibleVia,
  type ExchangeEligibilityPort,
  type MemberId,
} from "@jigswap/domain";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import {
  circleRoutesFor,
  exchangeRoutesFor,
} from "../../library/exchangeRoutes";

// Driven adapter for the ExchangeEligibilityPort: resolve the member's routes to the copy, then let
// Sharing's pure rules decide. A missing copy is not eligible (the use case reports it first anyway).
export const convexExchangeEligibility = (
  ctx: QueryCtx,
): ExchangeEligibilityPort => ({
  async eligibleVia(
    memberId: MemberId,
    copyId: CopyId,
  ): Promise<EligibleVia | null> {
    const copy = await ctx.db.get(copyId as unknown as Id<"ownedPuzzles">);
    if (!copy) return null;
    return exchangeAllowedVia(
      await exchangeRoutesFor(ctx, memberId as unknown as Id<"users">, copy),
    );
  },

  async holdsCircleExchangeSeat(
    memberId: MemberId,
    copyId: CopyId,
  ): Promise<boolean> {
    const copy = await ctx.db.get(copyId as unknown as Id<"ownedPuzzles">);
    if (!copy) return false;
    return mayExchangeVia(
      await circleRoutesFor(ctx, memberId as unknown as Id<"users">, copy),
    );
  },
});

import type { ExchangeView } from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { toMemberView } from "../identity/toMemberView";
import { toExchangeFields, toOwnedPuzzleView } from "./readViews";

// Exchange read (thin adapter): a single exchange with its parties and the requested/offered owned
// copies. Join targets and the legacy ownerPuzzle/requesterPuzzle naming are preserved verbatim
// (these are the requested/offered OWNED copies, not the catalog definitions).
export const getExchangeById = query({
  args: { exchangeId: v.id("exchanges") },
  handler: async (ctx, args): Promise<ExchangeView | null> => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange) return null;

    const [requester, owner, ownerPuzzle, requesterPuzzle] = await Promise.all([
      ctx.db.get(exchange.initiatorId),
      ctx.db.get(exchange.recipientId),
      ctx.db.get(exchange.requestedPuzzleId),
      exchange.offeredPuzzleId ? ctx.db.get(exchange.offeredPuzzleId) : null,
    ]);

    return {
      ...toExchangeFields(exchange),
      requester: requester ? toMemberView(requester) : null,
      owner: owner ? toMemberView(owner) : null,
      ownerPuzzle: toOwnedPuzzleView(ownerPuzzle),
      requesterPuzzle: toOwnedPuzzleView(requesterPuzzle),
    };
  },
});

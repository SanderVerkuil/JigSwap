import { makeAcceptExchange } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { assertExchangeNotBlocked } from "../social/blocks";
import { runAction } from "./runAction";

// Recipient accepts a proposed exchange. Party-auth + legal transition enforced by the aggregate;
// a pair blocked either way is refused first (spec 2.6).
export const accept = mutation({
  args: { exchangeId: v.string() },
  handler: async (ctx, args) => {
    await assertExchangeNotBlocked(
      ctx,
      args.exchangeId,
      await requireMember(ctx),
    );
    return runAction(ctx, args.exchangeId, makeAcceptExchange);
  },
});

import { makeAcceptExchange } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { assertExchangeNotBlocked } from "../social/blocks";
import { convexExchangeEligibility } from "./adapters/convexExchangeEligibility";
import { runAction } from "./runAction";

// Recipient accepts a proposed exchange. Party-auth + legal transition enforced by the aggregate;
// a pair blocked either way is refused first (spec 2.6). When the request rested on the initiator's
// circle seats, their circle standing is checked again (they may have been demoted or left since);
// the owner's own later changes never block accepting.
export const accept = mutation({
  args: { exchangeId: v.string() },
  handler: async (ctx, args) => {
    await assertExchangeNotBlocked(
      ctx,
      args.exchangeId,
      await requireMember(ctx),
    );
    return runAction(ctx, args.exchangeId, (deps) =>
      makeAcceptExchange({
        ...deps,
        eligibility: convexExchangeEligibility(ctx),
      }),
    );
  },
});

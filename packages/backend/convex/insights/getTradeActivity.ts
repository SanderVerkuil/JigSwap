import { computeTradeActivity, type ExchangeStatStatus } from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Insights read query: the member's exchange activity (counts by status and by month) for the trade
// chart. The member is a party as either initiator or recipient, so both indexes are unioned.
export const getTradeActivity = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    const asInitiator = await ctx.db
      .query("exchanges")
      .withIndex("by_initiator", (q) => q.eq("initiatorId", userId))
      .collect();
    const asRecipient = await ctx.db
      .query("exchanges")
      .withIndex("by_recipient", (q) => q.eq("recipientId", userId))
      .collect();

    return computeTradeActivity(
      [...asInitiator, ...asRecipient].map((e) => ({
        status: e.status as ExchangeStatStatus,
        createdAt: e.createdAt,
      })),
    );
  },
});

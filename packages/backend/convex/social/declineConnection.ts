import { toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  connectionOfferUnavailable,
  loadOfferForRecipient,
} from "./connectionOffers";

// The recipient declines ("Not now") a connection offer. Silent: no event, nothing for the
// inviter, no follow edges.
export const declineConnection = mutation({
  args: { offerId: v.string() },
  handler: async (ctx, { offerId }): Promise<void> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const { row, offer } = await loadOfferForRecipient(ctx, me, offerId);
    const now = new Date();
    if (offer.decline(toMemberId(me), now).isErr) {
      throw connectionOfferUnavailable();
    }
    await ctx.db.patch(row._id, {
      status: offer.status,
      respondedAt: now.getTime(),
    });
  },
});

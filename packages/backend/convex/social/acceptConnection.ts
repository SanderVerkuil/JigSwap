import { toMemberId } from "@jigswap/domain";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isBlockedEitherWay } from "./blocks";
import {
  connectionOfferUnavailable,
  loadOfferForRecipient,
} from "./connectionOffers";
import { establishMutualFollow } from "./establishMutualFollow";

// The recipient accepts a connection offer: the mutual follow is created now, through
// establishMutualFollow, which keeps the decline-cooldown gate and emits MemberFollowed (feed and
// new_follower for both). The link that produced the offer gets its followsEstablished, counted
// only when an edge was actually created. `connected` is false when the cooldown refused.
export const acceptConnection = mutation({
  args: { offerId: v.string() },
  handler: async (ctx, { offerId }): Promise<{ connected: boolean }> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const { row, offer } = await loadOfferForRecipient(ctx, me, offerId);
    const now = new Date();
    if (offer.accept(toMemberId(me), now).isErr) {
      throw connectionOfferUnavailable();
    }
    // A block either way since the offer (spec 2.6): the same generic refusal as a gone offer.
    if (await isBlockedEitherWay(ctx, row.fromId, row.toId)) {
      throw connectionOfferUnavailable();
    }
    const inviter = await ctx.db.get(row.fromId);
    if (inviter === null || !inviter.isActive) {
      throw connectionOfferUnavailable();
    }

    await ctx.db.patch(row._id, {
      status: offer.status,
      respondedAt: now.getTime(),
    });
    const result = await establishMutualFollow(ctx, row.fromId, row.toId);
    if (result.edgesCreated > 0 && row.inviteLinkId !== undefined) {
      const link = await ctx.db.get(row.inviteLinkId);
      if (link !== null) {
        await ctx.db.patch(link._id, {
          followsEstablished: link.followsEstablished + 1,
        });
      }
    }
    return { connected: result.established };
  },
});

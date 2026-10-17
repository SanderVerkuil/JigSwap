import type { WhatsNewStateView } from "@jigswap/contracts";
import { unreadWhatsNewEntryIds } from "@jigswap/domain";
import { query } from "../_generated/server";
import { whatsNewManifest } from "./manifest";
import { readStateOf, requireMemberUser } from "./readState";

// The acting member's What's new state: unread entry ids (newest first; entries published before
// the account existed are never unread) and their tour progress.
export const getWhatsNewState = query({
  args: {},
  handler: async (ctx): Promise<WhatsNewStateView> => {
    const member = await requireMemberUser(ctx);
    const row = await readStateOf(ctx, member._id);
    const tours = await ctx.db
      .query("whatsNewTourProgress")
      .withIndex("by_member_tour", (q) => q.eq("memberId", member._id))
      .collect();
    return {
      unreadIds: unreadWhatsNewEntryIds(whatsNewManifest(), {
        memberCreatedAt: member.createdAt,
        seenIds: row?.seenEntryIds ?? [],
      }),
      tours: tours.map((tour) => ({
        tourId: tour.tourId,
        status: tour.status,
        ...(tour.step !== undefined ? { step: tour.step } : {}),
        updatedAt: tour.updatedAt,
      })),
    };
  },
});

import type { ConnectionOfferView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { memberTeaserIdentityOf } from "./privacy";

// Read side: the acting member's open connection offers (pending and not yet expired), newest
// first. The inviter is shown as an initiator, like a follow requester or household inviter
// (listIncomingFollowRequests, listMyHouseholdInvites). They chose to invite this person, and the
// invite landing already named them, so a private profile does not hide them here. They are
// shown with exactly what that landing disclosed (memberTeaserIdentityOf: name, handle, avatar;
// never bio or location). Deleted and deactivated inviters are skipped, since accepting would fail.
export const listMyConnectionOffers = query({
  args: {},
  handler: async (ctx): Promise<ConnectionOfferView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const now = Date.now();
    const pending = await ctx.db
      .query("connectionOffers")
      .withIndex("by_to_status", (q) =>
        q.eq("toId", me).eq("status", "pending"),
      )
      .collect();

    const result: ConnectionOfferView[] = [];
    for (const row of pending) {
      if (row.expiresAt <= now) continue;
      // TODO(blocks): when social/blocks.ts lands, skip the offer if isBlockedEitherWay(fromId, me).
      const inviter = await ctx.db.get(row.fromId);
      if (inviter === null || !inviter.isActive) continue;
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_member", (q) => q.eq("memberId", row.fromId))
        .unique();
      result.push({
        offerId: row.aggregateId,
        from: memberTeaserIdentityOf(inviter, profile, true),
        source: row.source,
        createdAt: row.createdAt,
      });
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  },
});

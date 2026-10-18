import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  inboxListable,
  participantUnreadCountOf,
  threadRowByAggregateId,
} from "./readModelHelpers";

// The caller's total unread messages across all their threads — the app-shell badge number.
// Each summand is the same per-thread capped count getMyInbox shows (the membership's
// denormalized unreadCount, scan fallback; see UNREAD_SCAN_CAP), and
// only threads getMyInbox would render count (see inboxListable) so the badge never shows
// unread the inbox doesn't. Muted threads are left out (Q9): their row shows a grey count.
export const getUnreadTotal = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const memberships = await ctx.db
      .query("threadParticipants")
      .withIndex("by_member", (q) => q.eq("memberId", me))
      .collect();

    let total = 0;
    for (const membership of memberships) {
      if (membership.muted === true) continue;
      const thread = await threadRowByAggregateId(
        ctx,
        membership.threadAggregateId,
      );
      if (thread && (await inboxListable(ctx, thread, me))) {
        total += await participantUnreadCountOf(ctx, thread, membership);
      }
    }
    return total;
  },
});

import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import {
  subjectRenders,
  threadRowByAggregateId,
  unreadCountOf,
} from "./readModelHelpers";

// The caller's total unread messages across all their threads — the app-shell badge number.
// Each summand is the same per-thread capped count getMyInbox shows (see UNREAD_SCAN_CAP), and
// only threads getMyInbox would render count (see subjectRenders) so the badge never shows
// unread the inbox doesn't.
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
      const thread = await threadRowByAggregateId(
        ctx,
        membership.threadAggregateId,
      );
      if (thread && (await subjectRenders(ctx, thread))) {
        total += await unreadCountOf(ctx, thread, me);
      }
    }
    return total;
  },
});

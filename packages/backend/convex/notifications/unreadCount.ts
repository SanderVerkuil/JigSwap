import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// The badge stops counting here, so the read stays bounded however many unread rows a member
// piles up. A result equal to the cap means "this many or more"; the web shows "99+" past 99.
export const UNREAD_COUNT_CAP = 100;

// Read side: how many of the caller's notifications are unread (the badge count). Auth-gated and
// scoped to the acting member; reads at most UNREAD_COUNT_CAP unread rows via the by_user_read
// index.
export const unreadCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const memberId = await requireMember(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", memberId as unknown as Id<"users">).eq("isRead", false),
      )
      .take(UNREAD_COUNT_CAP);
    return rows.length;
  },
});

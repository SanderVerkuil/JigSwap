import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side: how many of the caller's notifications are unread (the badge count). Auth-gated and
// scoped to the acting member; reads only the unread rows via the by_user_read index.
export const unreadCount = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const memberId = await requireMember(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) =>
        q.eq("userId", memberId as unknown as Id<"users">).eq("isRead", false),
      )
      .collect();
    return rows.length;
  },
});

import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side: the caller's notifications, newest first. Auth-gated; scoped to the acting member.
// Returns the raw rows (the UI shapes them); aggregateId is the stable id markRead takes.
export const listMyNotifications = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    return ctx.db
      .query("notifications")
      .withIndex("by_user", (q) =>
        q.eq("userId", memberId as unknown as Id<"users">),
      )
      .order("desc")
      .collect();
  },
});

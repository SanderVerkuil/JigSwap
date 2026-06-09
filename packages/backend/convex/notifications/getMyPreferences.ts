import { NotificationPreference, toId } from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Read side: the caller's notification preference toggles (type -> channel -> enabled). If the
// member has no stored preference yet, returns the sensible defaults (all types on inApp; email/
// push off) WITHOUT persisting — reads stay side-effect-free; the row is materialised lazily on
// the first toggle (updateNotificationPreference) or the first NotifyMember.
export const getMyPreferences = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const row = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_member", (q) =>
        q.eq("memberId", memberId as unknown as Id<"users">),
      )
      .unique();

    if (row) return row.toggles;

    // No stored preference: derive the defaults in the domain so this query and NotifyMember agree.
    const fresh = NotificationPreference.createDefault(
      toId<"NotificationPreferenceId">("default"),
      toId<"MemberId">(memberId as string),
      new Date(),
    );
    return fresh.toState().toggles;
  },
});

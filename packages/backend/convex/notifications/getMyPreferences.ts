import {
  NotificationPreference,
  toMemberId,
  toNotificationPreferenceId,
} from "@jigswap/domain";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toDomain } from "./adapters/convexNotificationPreferenceRepository";

// Read side: the caller's resolved notification preferences (type -> {inApp, email, push}), the
// same per-channel stored-over-default merge `allows` uses for delivery. Every NOTIFICATION_TYPES
// member is present: types absent from an older stored row (untouched, or added after the row was
// written) resolve to their defaults; explicit stored values (including false) always win. Reads
// stay side-effect-free — the row is materialised lazily on the first toggle
// (updateNotificationPreference) or NotifyMember.
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

    // `toDomain` is the repository's mapper, reused here directly: this is a `query` (QueryCtx),
    // while the repository itself is typed against MutationCtx for its write-capable `save`.
    if (row) return toDomain(row).resolvedToggles();

    // No stored preference: derive the defaults in the domain so this query and NotifyMember agree.
    const fresh = NotificationPreference.createDefault(
      toNotificationPreferenceId("default"),
      toMemberId(memberId as string),
      new Date(),
    );
    return fresh.resolvedToggles();
  },
});

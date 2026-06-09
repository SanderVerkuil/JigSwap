import {
  type MemberId,
  NotificationPreference,
  type NotificationPreferenceRepository,
  type NotificationPreferenceState,
  toId,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

// Driven adapter for the NotificationPreferenceRepository port over `ctx.db`
// (`notificationPreferences`). One row per member, keyed by `memberId`. `toggles` is the resolved
// type->channel->enabled map, plain JSON, stored as-is (v.any) so the mapping is a direct copy.

const toDomain = (row: Doc<"notificationPreferences">): NotificationPreference => {
  const state: NotificationPreferenceState = {
    id: toId<"NotificationPreferenceId">(
      (row.aggregateId ?? (row._id as unknown as string)) as string,
    ),
    memberId: toId<"MemberId">(row.memberId as unknown as string) as MemberId,
    toggles: row.toggles as NotificationPreferenceState["toggles"],
    updatedAt: new Date(row.updatedAt),
  };
  return NotificationPreference.rehydrate(state);
};

export const convexNotificationPreferenceRepository = (
  ctx: MutationCtx,
): NotificationPreferenceRepository => ({
  async findByMember(memberId: MemberId): Promise<NotificationPreference | null> {
    const row = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_member", (q) =>
        q.eq("memberId", memberId as unknown as Id<"users">),
      )
      .unique();
    return row ? toDomain(row) : null;
  },

  async save(preference: NotificationPreference): Promise<void> {
    const state = preference.toState();
    const row = {
      aggregateId: state.id as string,
      memberId: state.memberId as unknown as Id<"users">,
      toggles: state.toggles,
      updatedAt: state.updatedAt.getTime(),
    };
    const existing = await ctx.db
      .query("notificationPreferences")
      .withIndex("by_member", (q) =>
        q.eq("memberId", state.memberId as unknown as Id<"users">),
      )
      .unique();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("notificationPreferences", row);
  },
});

import {
  NotificationPreference,
  toMemberId,
  toNotificationPreferenceId,
  type MemberId,
  type NotificationPreferenceRepository,
  type NotificationPreferenceState,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

// Driven adapter for the NotificationPreferenceRepository port over `ctx.db`
// (`notificationPreferences`). One row per member, keyed by `memberId`. `toggles` is the resolved
// type->channel->enabled map, plain JSON, stored as-is (v.any) so the mapping is a direct copy;
// `messagePreviews` (optional) is copied the same way.

// Exported so read-only queries (which get a QueryCtx, not the MutationCtx this adapter's
// `findByMember` requires) can still rehydrate a row into the aggregate without duplicating the
// mapping (see notifications/getMyPreferences.ts).
export const toDomain = (
  row: Doc<"notificationPreferences">,
): NotificationPreference => {
  const state: NotificationPreferenceState = {
    id: toNotificationPreferenceId(
      (row.aggregateId ?? (row._id as unknown as string)) as string,
    ),
    memberId: toMemberId(row.memberId as unknown as string),
    toggles: row.toggles as NotificationPreferenceState["toggles"],
    ...(row.messagePreviews !== undefined
      ? { messagePreviews: row.messagePreviews }
      : {}),
    updatedAt: new Date(row.updatedAt),
  };
  return NotificationPreference.rehydrate(state);
};

// A member's preference for a read-only caller (a query, or send-time resolution): the stored row,
// or the domain defaults when none is stored yet (a row is only materialised on the first write).
export const preferenceOrDefault = async (
  ctx: QueryCtx,
  memberId: Id<"users">,
): Promise<NotificationPreference> => {
  const row = await ctx.db
    .query("notificationPreferences")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .unique();
  return row
    ? toDomain(row)
    : NotificationPreference.createDefault(
        toNotificationPreferenceId("default"),
        toMemberId(memberId as string),
        new Date(),
      );
};

export const convexNotificationPreferenceRepository = (
  ctx: MutationCtx,
): NotificationPreferenceRepository => ({
  async findByMember(
    memberId: MemberId,
  ): Promise<NotificationPreference | null> {
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
      ...(state.messagePreviews !== undefined
        ? { messagePreviews: state.messagePreviews }
        : {}),
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

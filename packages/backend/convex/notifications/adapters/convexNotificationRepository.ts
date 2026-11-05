import {
  Notification,
  type MemberId,
  type NotificationId,
  type NotificationRepository,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./notificationMapper";

// The most unread rows one markAllReadForUser call patches. notifications/markAllRead schedules
// further batches while unread rows remain, so a huge backlog never exceeds one mutation's limits.
export const MARK_ALL_READ_BATCH = 500;

// Driven adapter for the NotificationRepository port over `ctx.db` (the `notifications` table).
// Identity is the aggregateId; saves upsert on it so re-saving a rehydrated notification patches
// the same row (e.g. markRead) rather than duplicating it.
export const convexNotificationRepository = (
  ctx: MutationCtx,
): NotificationRepository => {
  const rowByAggregateId = (
    id: NotificationId,
  ): Promise<Doc<"notifications"> | null> =>
    ctx.db
      .query("notifications")
      .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", id as string))
      .unique();

  return {
    async findById(id: NotificationId): Promise<Notification | null> {
      const row = await rowByAggregateId(id);
      return row ? toDomain(row) : null;
    },

    async save(notification: Notification): Promise<void> {
      const row = toRow(notification);
      const existing = await rowByAggregateId(notification.id);
      if (existing) {
        // The aggregate holds only the newest actor, so its actor refs would collapse a grouped
        // row to one actor. Actor refs are write-once here (set on insert; grouping and the
        // backfill patch them directly), so a re-save keeps the stored ones. The grouping fields
        // (groupKey/updatedAt) are not in the row payload and survive the patch as well.
        const { actorIds: _actorIds, actorCount: _actorCount, ...rest } = row;
        await ctx.db.patch(existing._id, rest);
      } else await ctx.db.insert("notifications", row);
    },

    async listByUser(userId: MemberId): Promise<Notification[]> {
      const rows = await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) =>
          q.eq("userId", userId as unknown as Id<"users">),
        )
        .order("desc")
        .collect();
      // Only domain-written/backfilled rows (carrying an aggregateId) participate in the new path.
      return rows
        .filter((row) => row.aggregateId !== undefined)
        .map((row) => toDomain(row));
    },

    async markAllReadForUser(
      userId: MemberId,
      now: Date,
    ): Promise<Notification[]> {
      // Only unread rows, one bounded batch (by_user_read); the caller continues past it.
      const rows = await ctx.db
        .query("notifications")
        .withIndex("by_user_read", (q) =>
          q.eq("userId", userId as unknown as Id<"users">).eq("isRead", false),
        )
        .take(MARK_ALL_READ_BATCH);
      const affected: Notification[] = [];
      for (const row of rows) {
        // A legacy row (no aggregateId) has no aggregate or event, but it still lights the badge:
        // mark it read directly so "mark all read" clears everything. Every row read here ends up
        // read, which is what lets the caller's continuation always make progress.
        if (row.aggregateId === undefined) {
          await ctx.db.patch(row._id, { isRead: true });
          continue;
        }
        const notification = toDomain(row);
        const result = notification.markRead(userId, now);
        // markRead only fails on a wrong owner; the scan is scoped to this user, so it cannot.
        if (result.isErr) continue;
        await ctx.db.patch(row._id, { isRead: true });
        affected.push(notification);
      }
      return affected;
    },
  };
};

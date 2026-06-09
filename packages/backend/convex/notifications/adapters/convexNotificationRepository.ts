import {
  type MemberId,
  Notification,
  type NotificationId,
  type NotificationRepository,
} from "@jigswap/domain";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { toDomain, toRow } from "./notificationMapper";

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
      if (existing) await ctx.db.patch(existing._id, row);
      else await ctx.db.insert("notifications", row);
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
      const rows = await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) =>
          q.eq("userId", userId as unknown as Id<"users">),
        )
        .collect();
      const affected: Notification[] = [];
      for (const row of rows) {
        if (row.aggregateId === undefined || row.isRead) continue;
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

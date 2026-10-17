import type { Notification } from "@jigswap/domain";
import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { convexNotificationRepository } from "../convexNotificationRepository";
import { toRow } from "../notificationMapper";

// Write-time grouping (new_follower only): a new follower joins the recipient's unread
// new_follower row if it absorbed an actor within the window, instead of adding a row.
const NEW_FOLLOWER_GROUP = "new_follower";
export const GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;
// The stored actor ids are capped; actorCount keeps counting past it.
export const MAX_GROUPED_ACTOR_IDS = 10;

// The REAL in-app channel: delivery here means persisting a notification row, so it shows up in
// the member's in-app feed. All other channels (email/push) are out-of-band and persist nothing,
// so they stay one delivery per event even when the in-app row is grouped.
export const inAppChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    if (state.type !== "new_follower" || state.actorId === undefined) {
      await convexNotificationRepository(ctx).save(notification);
      return;
    }

    const userId = state.userId as unknown as Id<"users">;
    const actorId = state.actorId as unknown as Id<"users">;
    const now = state.createdAt.getTime();
    const open = await ctx.db
      .query("notifications")
      .withIndex("by_user_group", (q) =>
        q
          .eq("userId", userId)
          .eq("groupKey", NEW_FOLLOWER_GROUP)
          .eq("isRead", false),
      )
      .collect();
    const lastTouched = (row: Doc<"notifications">) =>
      row.updatedAt ?? row.createdAt;
    const target = open
      .filter((row) => now - lastTouched(row) <= GROUP_WINDOW_MS)
      .reduce<Doc<"notifications"> | null>(
        (newest, row) =>
          !newest || lastTouched(row) > lastTouched(newest) ? row : newest,
        null,
      );

    if (!target) {
      // A fresh notification (new aggregateId), so a plain insert; it opens a new group.
      await ctx.db.insert("notifications", {
        ...toRow(notification),
        groupKey: NEW_FOLLOWER_GROUP,
      });
      return;
    }

    // Merge: the actor moves to the front (deduped); only a new distinct actor counts.
    const previous = target.actorIds ?? [];
    const alreadyIn = previous.includes(actorId);
    const actorIds = [
      actorId,
      ...previous.filter((id) => id !== actorId),
    ].slice(0, MAX_GROUPED_ACTOR_IDS);
    const actorCount =
      Math.max(target.actorCount ?? 0, previous.length) + (alreadyIn ? 0 : 1);

    // The feed reads `by_user` newest first, i.e. by `_creationTime`, so a merged row must be
    // re-inserted to surface at the top. Delete + re-insert keeps the aggregateId (the id the web
    // keys rows on and markRead looks up), its original createdAt and its group. An index on
    // updatedAt would instead need every legacy row to carry a sort field (a backfill) and a
    // second ordering for the feed and markAllRead.
    const { _id, _creationTime, ...kept } = target;
    await ctx.db.delete(_id);
    await ctx.db.insert("notifications", {
      ...kept,
      // The newest follower's snapshot (name for legacy renderers), matching actorIds[0].
      ...(state.params !== undefined
        ? { params: state.params as Record<string, string> }
        : {}),
      ...(state.relatedId !== undefined ? { relatedId: state.relatedId } : {}),
      actorIds,
      actorCount,
      isRead: false,
      updatedAt: now,
    });
  };

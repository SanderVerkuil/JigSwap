import type { Notification, NotificationState } from "@jigswap/domain";
import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { ADMIN_NOTIFICATION_TYPES } from "../../viewRules";
import { convexNotificationRepository } from "../convexNotificationRepository";
import { toRow } from "../notificationMapper";

// Write-time grouping: a new follower joins the recipient's unread new_follower row if it absorbed
// an actor within the window, a message joins the recipient's unread row for its thread
// (`thread:<threadId>`, DMs and circle threads alike, no window: one unread row per thread), and a
// submission or suggestion for review joins the admin's unread row for that review queue
// (`admin_review:<type>`, no window; SEC-26: a flood is one row that keeps counting, until the admin
// has read it), instead of adding a row.
const NEW_FOLLOWER_GROUP = "new_follower";
export const GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;

const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "message_received",
  "circle_message_received",
]);

// The group a notification joins and how long an unread row stays open to it; null = ungrouped.
// `countsItems`: the group's copy says how many items arrived, which actorCount can't (one member's
// twenty submissions are one actor).
const groupOf = (
  state: NotificationState,
): { key: string; windowMs: number; countsItems?: true } | null => {
  if (state.actorId === undefined) return null;
  if (state.type === "new_follower") {
    return { key: NEW_FOLLOWER_GROUP, windowMs: GROUP_WINDOW_MS };
  }
  if (MESSAGE_TYPES.has(state.type) && state.subject?.kind === "thread") {
    return {
      key: `thread:${state.subject.threadId}`,
      windowMs: Number.POSITIVE_INFINITY,
    };
  }
  if (ADMIN_NOTIFICATION_TYPES.has(state.type)) {
    return {
      key: `admin_review:${state.type}`,
      windowMs: Number.POSITIVE_INFINITY,
      countsItems: true,
    };
  }
  return null;
};
// The stored actor ids are capped; actorCount keeps counting past it.
export const MAX_GROUPED_ACTOR_IDS = 10;

// The REAL in-app channel: delivery here means persisting a notification row, so it shows up in
// the member's in-app feed. All other channels (email/push) are out-of-band and persist nothing:
// grouping here never holds them back, only their own throttles do (emailChannel, pushChannel).
export const inAppChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    const group = groupOf(state);
    if (group === null || state.actorId === undefined) {
      await convexNotificationRepository(ctx).save(notification);
      return;
    }

    const userId = state.userId as unknown as Id<"users">;
    const actorId = state.actorId as unknown as Id<"users">;
    const now = state.createdAt.getTime();
    const open = await ctx.db
      .query("notifications")
      .withIndex("by_user_group", (q) =>
        q.eq("userId", userId).eq("groupKey", group.key).eq("isRead", false),
      )
      .collect();
    const lastTouched = (row: Doc<"notifications">) =>
      row.updatedAt ?? row.createdAt;
    const target = open
      .filter((row) => now - lastTouched(row) <= group.windowMs)
      .reduce<Doc<"notifications"> | null>(
        (newest, row) =>
          !newest || lastTouched(row) > lastTouched(newest) ? row : newest,
        null,
      );

    if (!target) {
      // A fresh notification (new aggregateId), so a plain insert; it opens a new group.
      await ctx.db.insert("notifications", {
        ...toRow(notification),
        groupKey: group.key,
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
      // The newest delivery's params (no actor name since SEC-68: the actor is the ref in
      // actorIds[0]); a legacy row's name snapshot is replaced along with them.
      ...(state.params !== undefined
        ? { params: state.params as Record<string, string> }
        : {}),
      ...(state.relatedId !== undefined ? { relatedId: state.relatedId } : {}),
      actorIds,
      actorCount,
      ...(group.countsItems ? { itemCount: (target.itemCount ?? 1) + 1 } : {}),
      isRead: false,
      updatedAt: now,
    });
  };

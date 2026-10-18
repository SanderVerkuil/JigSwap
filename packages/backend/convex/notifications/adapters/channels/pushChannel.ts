import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { renderNotificationText } from "../../copy";
import { deliveryRefsOf } from "../../deliveryContent";

// Web Push channel: schedules the out-of-band send (notifications/sendWebPush) after commit, which
// fans the notification out to every active push subscription of the recipient via VAPID. The
// action re-renders the copy from the delivery resolved for the recipient (actor, live context,
// deep link); the snapshot title/message rendered HERE from type+params stay as the args the action
// has always taken. English-only by design (push localization is out of scope). No-ops downstream
// when push is unconfigured or the member has no subscriptions.
//
// A message (only messages: other thread notices are never held back) is pushed at most once per
// thread per member per PUSH_THROTTLE_MS (the thread's participant row keeps lastPushedAt); the
// OS replaces rather than stacks a thread's pushes via the payload's thread tag (sendWebPush).
export const PUSH_THROTTLE_MS = 2 * 60 * 1000;

export const pushChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    // No push subscription: nothing to send to, so no throttle write and no Node action (each
    // scheduled action is a billed function call, for every member who never enabled push).
    const subscribed = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) =>
        q.eq("userId", state.userId as unknown as Id<"users">),
      )
      .first();
    if (!subscribed) return;
    if (
      (state.type === "message_received" ||
        state.type === "circle_message_received") &&
      state.subject?.kind === "thread"
    ) {
      const threadId = state.subject.threadId;
      const seat = await ctx.db
        .query("threadParticipants")
        .withIndex("by_thread_member", (q) =>
          q
            .eq("threadAggregateId", threadId)
            .eq("memberId", state.userId as unknown as Id<"users">),
        )
        .first();
      const now = state.createdAt.getTime();
      if (seat) {
        if (
          seat.lastPushedAt !== undefined &&
          now - seat.lastPushedAt < PUSH_THROTTLE_MS
        ) {
          return;
        }
        await ctx.db.patch(seat._id, { lastPushedAt: now });
      }
    }
    const { title, message } = renderNotificationText(
      state.type,
      state.params ?? {},
    );
    await ctx.scheduler.runAfter(0, internal.notifications.sendWebPush.send, {
      userId: state.userId as unknown as Id<"users">,
      type: state.type as string,
      title,
      message,
      relatedId: state.relatedId,
      params: (state.params ?? {}) as Record<string, string>,
      ...deliveryRefsOf(state),
    });
  };

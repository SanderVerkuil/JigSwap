import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

// Web Push channel: schedules the out-of-band send (notifications/sendWebPush) after commit, which
// fans the notification out to every active push subscription of the recipient via VAPID. Scheduling
// (rather than sending here) keeps the delivering mutation transactional and fast, and the action
// only runs once the in-app row durably exists. No-ops downstream when push is unconfigured (no
// VAPID keys) or the member has no subscriptions — opting into push never creates in-app rows.
export const pushChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
    await ctx.scheduler.runAfter(0, internal.notifications.sendWebPush.send, {
      userId: state.userId as unknown as Id<"users">,
      type: state.type as string,
      title: state.title,
      message: state.message,
      relatedId: state.relatedId,
    });
  };

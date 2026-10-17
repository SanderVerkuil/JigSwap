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
export const pushChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    const state = notification.toState();
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

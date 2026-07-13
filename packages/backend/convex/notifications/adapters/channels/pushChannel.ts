import type { Notification } from "@jigswap/domain";
import { internal } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { renderNotificationText } from "../../copy";

// Web Push channel: schedules the out-of-band send (notifications/sendWebPush) after commit, which
// fans the notification out to every active push subscription of the recipient via VAPID. Copy is
// rendered HERE from the structured type+params (English-only by design — push localization is out
// of scope); the notification row itself carries no pre-rendered strings anymore. No-ops downstream
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
    });
  };

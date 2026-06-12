import type {
  Channel,
  Notification,
  NotificationDelivery,
} from "@jigswap/domain";
import type { MutationCtx } from "../../_generated/server";
import { emailChannel } from "./channels/emailChannel";
import { inAppChannel } from "./channels/inAppChannel";
import { pushChannel } from "./channels/pushChannel";

// Driven adapter for the NotificationDelivery port: routes each Channel to its concrete delivery.
// in-app PERSISTS (real); email/push hand off to Knock (knock.app) via a scheduled action. The use
// case stays unaware of the medium — it just hands over (channel, notification) for the allowed
// channels.
export const convexNotificationDelivery = (
  ctx: MutationCtx,
): NotificationDelivery => {
  const inApp = inAppChannel(ctx);
  const email = emailChannel(ctx);
  const push = pushChannel(ctx);
  return {
    async deliver(channel: Channel, notification: Notification): Promise<void> {
      switch (channel) {
        case "inApp":
          return inApp(notification);
        case "email":
          return email(notification);
        case "push":
          return push(notification);
      }
    },
  };
};

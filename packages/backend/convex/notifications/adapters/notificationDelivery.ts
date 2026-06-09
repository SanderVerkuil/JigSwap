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
// in-app PERSISTS (real); email/push are dormant stubs until Phase 5+. The use case stays unaware
// of the medium — it just hands over (channel, notification) for the allowed channels.
export const convexNotificationDelivery = (
  ctx: MutationCtx,
): NotificationDelivery => {
  const inApp = inAppChannel(ctx);
  return {
    async deliver(channel: Channel, notification: Notification): Promise<void> {
      switch (channel) {
        case "inApp":
          return inApp(notification);
        case "email":
          return emailChannel(notification);
        case "push":
          return pushChannel(notification);
      }
    },
  };
};

import type { Notification } from "@jigswap/domain";
import type { MutationCtx } from "../../../_generated/server";
import { convexNotificationRepository } from "../convexNotificationRepository";

// The REAL in-app channel: delivery here means persisting a notification row, so it shows up in
// the member's in-app feed. All other channels (email/push) are out-of-band and persist nothing.
export const inAppChannel =
  (ctx: MutationCtx) =>
  async (notification: Notification): Promise<void> => {
    await convexNotificationRepository(ctx).save(notification);
  };

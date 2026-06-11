import { makeMarkAllRead } from "@jigswap/domain";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexNotificationRepository } from "./adapters/convexNotificationRepository";
import { systemClock } from "./adapters/systemClock";

// Notification's own events are leaf events (no downstream subscriber); drop them.
const noopEvents = { async publish(): Promise<void> {} };

// Mark every unread notification for the caller as read. The member is resolved from auth; the
// repository scan is scoped to them, so no per-row ownership check is needed. Returns the count.
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);

    const markAll = makeMarkAllRead({
      notifications: convexNotificationRepository(ctx),
      events: noopEvents,
      clock: systemClock,
    });
    const result = await markAll({ memberId });
    // makeMarkAllRead never errors (Result<number, never>); return the count for the UI.
    return result.isErr ? 0 : result.value;
  },
});

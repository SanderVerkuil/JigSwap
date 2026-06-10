import { makeMarkNotificationRead, toNotificationId } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexNotificationRepository } from "./adapters/convexNotificationRepository";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Driven publisher: Notification's own events have no downstream subscriber (leaf context), so we
// drop them rather than loop them back through the durable dispatcher.
const noopEvents = { async publish(): Promise<void> {} };

// Mark one of the caller's notifications read. Ownership is enforced in the aggregate (the member
// is resolved from auth, never trusted from args). `notificationId` is the aggregateId.
export const markNotificationRead = mutation({
  args: { notificationId: v.string() },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    const markRead = makeMarkNotificationRead({
      notifications: convexNotificationRepository(ctx),
      events: noopEvents,
      clock: systemClock,
    });
    const result = await markRead({
      memberId,
      notificationId: toNotificationId(args.notificationId),
    });
    if (result.isErr) throw toConvexError(result.error);
  },
});

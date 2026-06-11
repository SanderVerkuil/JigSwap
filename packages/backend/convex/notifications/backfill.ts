import { internalMutation } from "../_generated/server";

// One-shot migration: legacy notifications predate aggregateId + channel, so the domain path
// (which keys saves on aggregateId and carries a channel) can't act on them. Stamp a fresh
// NotificationId + the default "inApp" channel on every row still missing them. Idempotent: rows
// already carrying both are skipped, so re-running is safe.
export const backfillNotificationFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const notifications = await ctx.db.query("notifications").collect();

    let patched = 0;
    for (const notification of notifications) {
      const patch: { aggregateId?: string; channel?: string } = {};
      if (!notification.aggregateId) patch.aggregateId = crypto.randomUUID();
      if (!notification.channel) patch.channel = "inApp";
      if (Object.keys(patch).length === 0) continue;
      await ctx.db.patch(notification._id, patch);
      patched++;
    }

    return { patched };
  },
});

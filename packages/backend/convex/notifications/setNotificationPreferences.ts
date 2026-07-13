import { makeUpdateNotificationPreferences } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexNotificationPreferenceRepository } from "./adapters/convexNotificationPreferenceRepository";
import { notificationPreferenceIdGenerator } from "./adapters/idGenerators";
import { systemClock } from "./adapters/systemClock";
import {
  channelValidator,
  notificationTypeValidator,
} from "./preferenceValidators";

// PreferenceChanged is a leaf event (no downstream subscriber); drop it.
const noopEvents = { async publish(): Promise<void> {} };

// 21 types × 3 channels — anything larger is a client bug, not a bigger matrix.
const MAX_UPDATES = 63;

// Bulk (type, channel) toggle for the caller — one aggregate load, one save, so a category
// header click in the preferences matrix is atomic (no partial category state on failure).
export const setNotificationPreferences = mutation({
  args: {
    updates: v.array(
      v.object({
        type: notificationTypeValidator,
        channel: channelValidator,
        enabled: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.updates.length > MAX_UPDATES) {
      throw new ConvexError("Too many updates in one call");
    }
    const memberId = await requireMember(ctx);
    const update = makeUpdateNotificationPreferences({
      preferences: convexNotificationPreferenceRepository(ctx),
      preferenceIds: notificationPreferenceIdGenerator,
      events: noopEvents,
      clock: systemClock,
    });
    await update({ memberId, updates: args.updates });
  },
});

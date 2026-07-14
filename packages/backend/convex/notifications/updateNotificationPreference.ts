import {
  type Channel,
  makeUpdateNotificationPreference,
  type NotificationType,
} from "@jigswap/domain";
import { v } from "convex/values";
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

// Toggle a single (type, channel) delivery for the caller. A member with no stored preference yet
// has a default one materialised before the toggle is applied (handled in the use case).
export const updateNotificationPreference = mutation({
  args: {
    type: notificationTypeValidator,
    channel: channelValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    const update = makeUpdateNotificationPreference({
      preferences: convexNotificationPreferenceRepository(ctx),
      preferenceIds: notificationPreferenceIdGenerator,
      events: noopEvents,
      clock: systemClock,
    });
    await update({
      memberId,
      type: args.type as NotificationType,
      channel: args.channel as Channel,
      enabled: args.enabled,
    });
  },
});

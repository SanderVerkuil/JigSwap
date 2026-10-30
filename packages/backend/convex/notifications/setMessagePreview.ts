import { makeSetMessagePreview } from "@jigswap/domain";
import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexNotificationPreferenceRepository } from "./adapters/convexNotificationPreferenceRepository";
import { notificationPreferenceIdGenerator } from "./adapters/idGenerators";
import { systemClock } from "./adapters/systemClock";
import { messagePreviewChannelValidator } from "./preferenceValidators";

// Let the caller's email or push notifications for a message quote its text, or not. Only ever
// the caller's own preference (the member comes from requireMember, never from the args); a
// member with no stored preference has a default one materialised first (in the use case).
export const setMessagePreview = mutation({
  args: {
    channel: messagePreviewChannelValidator,
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);
    await makeSetMessagePreview({
      preferences: convexNotificationPreferenceRepository(ctx),
      preferenceIds: notificationPreferenceIdGenerator,
      clock: systemClock,
    })({ memberId, channel: args.channel, enabled: args.enabled });
  },
});

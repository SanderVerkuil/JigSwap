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

// PreferenceChanged is a leaf event (no downstream subscriber); drop it.
const noopEvents = { async publish(): Promise<void> {} };

// The notification type literals, kept in sync with the domain NotificationType union (the schema
// `type` column). Validating here gives the UI a typed surface and rejects unknown types early.
const notificationType = v.union(
  v.literal("trade_request"),
  v.literal("trade_accepted"),
  v.literal("trade_declined"),
  v.literal("trade_completed"),
  v.literal("trade_cancelled"),
  v.literal("message_received"),
  v.literal("review_received"),
  v.literal("puzzle_favorited"),
  v.literal("goal_achieved"),
  v.literal("puzzle_approved"),
  v.literal("puzzle_rejected"),
  v.literal("photo_removed"),
  v.literal("exchange_proposed"),
  v.literal("exchange_disputed"),
  v.literal("proposal_approved"),
  v.literal("proposal_rejected"),
  v.literal("admin_proposal_filed"),
  v.literal("admin_definition_submitted"),
  v.literal("new_follower"),
  v.literal("follow_request_received"),
  v.literal("follow_request_approved"),
);

const channel = v.union(
  v.literal("inApp"),
  v.literal("email"),
  v.literal("push"),
);

// Toggle a single (type, channel) delivery for the caller. A member with no stored preference yet
// has a default one materialised before the toggle is applied (handled in the use case).
export const updateNotificationPreference = mutation({
  args: { type: notificationType, channel, enabled: v.boolean() },
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

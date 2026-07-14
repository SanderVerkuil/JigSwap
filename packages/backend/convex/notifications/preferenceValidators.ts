import { v } from "convex/values";

// The notification type literals, kept in sync with the domain NotificationType union (the schema
// `type` column). Validating here gives the UI a typed surface and rejects unknown types early.
export const notificationTypeValidator = v.union(
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

export const channelValidator = v.union(
  v.literal("inApp"),
  v.literal("email"),
  v.literal("push"),
);

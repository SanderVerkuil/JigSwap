// The canonical set of notification types — the SINGLE SOURCE OF TRUTH for this generic
// subdomain. Notifications is a pure subscriber: the backend subscriber translates each upstream
// context's domain events into one of these stable type literals (Notifications does NOT import
// other contexts' event shapes). New literals are added here as upstream contexts gain events the
// member should be told about; the persisted `type` column (4a-backend) maps one-to-one to this.
export type NotificationType =
  // --- existing literals (current `notifications` table) ---
  | "trade_request"
  | "trade_accepted"
  | "trade_declined"
  | "trade_completed"
  | "trade_cancelled"
  | "trade_cancelled_member_deleted" // Account deletion: an open exchange cancelled because the other party deleted their account
  | "message_received"
  | "review_received"
  | "puzzle_favorited"
  // --- new literals the other contexts now need ---
  | "goal_achieved" // Solving: GoalAchieved
  | "puzzle_approved" // Catalog: PuzzleDefinitionApproved (member's submission accepted)
  | "puzzle_rejected" // Catalog: submission rejected
  | "photo_removed" // Library: a moderator confirmed removal of an uploaded copy photo
  | "exchange_proposed" // Exchange: ExchangeProposed (distinct generic exchange, not only "trade")
  | "exchange_disputed" // Exchange: DisputeRaised
  | "proposal_approved" // Catalog: ChangeProposalApproved (member's suggested edit applied)
  | "proposal_rejected" // Catalog: suggested edit declined
  | "admin_proposal_filed" // Catalog: ChangeProposalFiled — admins are asked to review a suggested edit
  | "admin_definition_submitted" // Catalog: PuzzleDefinitionSubmitted — admins are asked to moderate a new submission
  | "new_follower" // Social: MemberFollowed (instant follow; suppressed when it came from an approval)
  | "follow_request_received" // Social: FollowRequested — a private-profile member has a pending request
  | "follow_request_approved" // Social: FollowRequestApproved — the requester's access was granted
  | "household_invite_received" // Household: HouseholdInviteSent — someone invited the member to their household
  | "household_invite_accepted" // Household: HouseholdInviteAccepted — the member's invite was accepted
  | "household_join_request_received" // Household: HouseholdJoinRequested — someone asked to join the admin's household
  | "household_join_request_approved" // Household: HouseholdJoinRequestApproved — the member's request to join was approved
  | "connection_offer_received" // Social: ConnectionOffered — their inviter offers to follow each other
  | "circle_invite_received" // Sharing: CircleInviteIssued — a circle Admin invited the member to join
  | "circle_invite_accepted" // Sharing: CircleInviteAccepted — the member's circle invite was accepted
  | "circle_deleted" // Sharing: CircleDeleted — the owner deleted a circle the member was in
  | "circle_message_received" // Conversation: MessagePosted in a circle (group) thread
  | "whats_new" // Product: a What's new entry marked `notify: true` was published (not a domain event)
  | "report_decided" // Safety: a moderator decided a report the member filed (DSA Art. 16(5))
  | "content_removed" // Safety: a moderator removed the member's reported content (DSA Art. 17)
  | "member_warned" // Safety: a moderator warned the member over a report (DSA Art. 17)
  | "message_image_rejected"; // Conversation: the automated check stopped a photo the member sent (DSA Art. 17)

// All notification types, for iteration (e.g. seeding default preferences). Kept in sync with the
// union above by construction.
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "trade_cancelled_member_deleted",
  "message_received",
  "review_received",
  "puzzle_favorited",
  "goal_achieved",
  "puzzle_approved",
  "puzzle_rejected",
  "photo_removed",
  "exchange_proposed",
  "exchange_disputed",
  "proposal_approved",
  "proposal_rejected",
  "admin_proposal_filed",
  "admin_definition_submitted",
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
  "household_invite_received",
  "household_invite_accepted",
  "household_join_request_received",
  "household_join_request_approved",
  "connection_offer_received",
  "circle_invite_received",
  "circle_invite_accepted",
  "circle_deleted",
  "circle_message_received",
  "whats_new",
  "report_decided",
  "content_removed",
  "member_warned",
  "message_image_rejected",
];

// Types that may be delivered by EMAIL. Deliberately a subset: only high-value, act-on-it
// notifications (trade lifecycle, messages, social) earn an inbox interruption; moderation and
// admin outcomes stay in-app/push. NotifyMember gates the email channel on this set REGARDLESS of
// stored preferences, so widening email coverage is an explicit product decision here — the web
// preference matrix mirrors this set (apps/web notification-meta.ts) to grey out the switches.
export const EMAIL_ELIGIBLE_TYPES: ReadonlySet<NotificationType> = new Set([
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "trade_cancelled_member_deleted",
  "message_received",
  "review_received",
  "puzzle_favorited",
  "goal_achieved",
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
  "circle_invite_received",
  // Never sent per message: the backend batches circle messages into a delayed per-thread digest.
  "circle_message_received",
]);

// Types the member cannot switch off in-app: the DSA Art. 17 statement of reasons must reach the
// member whose content a moderator restricted, whatever their preferences say. Other channels
// (push/email) still follow the preference.
export const MANDATORY_IN_APP_TYPES: ReadonlySet<NotificationType> = new Set([
  "content_removed",
  "member_warned",
  "message_image_rejected",
]);

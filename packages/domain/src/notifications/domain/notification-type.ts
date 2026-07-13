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
  | "follow_request_approved"; // Social: FollowRequestApproved — the requester's access was granted

// All notification types, for iteration (e.g. seeding default preferences). Kept in sync with the
// union above by construction.
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
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
  "message_received",
  "review_received",
  "puzzle_favorited",
  "goal_achieved",
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
]);

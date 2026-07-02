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
  | "exchange_disputed"; // Exchange: DisputeRaised

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
];

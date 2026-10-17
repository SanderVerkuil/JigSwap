// Notification read model (`notifications.listMyNotificationViews`). Every field is resolved
// server-side at read time from the row's stored refs: names, avatars, live statuses, the deep link
// and which inline actions still apply. The web renders it as-is and never infers state from a row.

/** The notification `type` literals (mirrors the domain NotificationType union; keep in sync by hand). */
export type NotificationViewType =
  | "trade_request"
  | "trade_accepted"
  | "trade_declined"
  | "trade_completed"
  | "trade_cancelled"
  | "message_received"
  | "review_received"
  | "puzzle_favorited"
  | "goal_achieved"
  | "puzzle_approved"
  | "puzzle_rejected"
  | "photo_removed"
  | "exchange_proposed"
  | "exchange_disputed"
  | "proposal_approved"
  | "proposal_rejected"
  | "admin_proposal_filed"
  | "admin_definition_submitted"
  | "new_follower"
  | "follow_request_received"
  | "follow_request_approved"
  | "household_invite_received"
  | "household_invite_accepted"
  | "whats_new";

/**
 * A member who caused the notification. Anonymous (deleted, deactivated, or not visible to the
 * viewer) carries nothing else: no id, name, avatar or handle. Never carries an email.
 */
export type NotificationActorView =
  | { anonymous: true }
  | {
      anonymous: false;
      memberId: string;
      /** Resolved display name; absent when the member has none (render the generic label). */
      name?: string;
      avatar?: string;
      /** The /members/$handle param (slug, else username, else the member id). */
      handle: string;
    };

/** An inline action the viewer can still take on the notification (recomputed on every read). */
export type NotificationActionKind =
  | "follow_back"
  | "approve_follow_request"
  | "approve_and_follow_back"
  | "decline_follow_request"
  | "accept_household_invite"
  | "decline_household_invite"
  | "reply_message";

export type NotificationExchangeStatus =
  "proposed" | "accepted" | "completed" | "rejected" | "cancelled" | "disputed";

export type NotificationViewState =
  "actionable" | "resolved" | "unavailable" | "informational";

export type NotificationResolvedAs =
  | "following_each_other"
  | "following"
  | "requested"
  | "approved"
  | "declined"
  | "joined"
  | "expired";

/** Only what the viewer may see, resolved now (falls back to the stored snapshot when unavailable). */
export interface NotificationViewContext {
  puzzleTitle?: string;
  thumbnailUrl?: string;
  goalTitle?: string;
  /** Moderator-entered rejection reason (proposal_rejected). */
  reason?: string;
  /** Star rating 1-5 (review_received). */
  rating?: number;
  /** The exchange's live status (trade types), when the viewer is still a party to it. */
  exchangeStatus?: NotificationExchangeStatus;
  /** The latest text message in the thread, ~80 chars (thread participants only). */
  messagePreview?: string;
  /**
   * The stored actor name of a row without actor refs (legacy), for types whose actor contacted
   * the viewer. Absent whenever `actors` is resolved.
   */
  actorNameSnapshot?: string;
}

export interface NotificationView {
  /** The notification aggregateId (what markRead takes); the Convex _id for pre-domain rows. */
  id: string;
  type: NotificationViewType;
  isRead: boolean;
  /** Creation time, or the last time a grouped row absorbed an actor. */
  createdAt: number;
  /** Up to 3 actors, newest first. */
  actors: NotificationActorView[];
  /** Total distinct actors (>= actors.length when grouped). */
  actorCount: number;
  context: NotificationViewContext;
  /** Where the row links to (computed server-side); null when there is no useful destination. */
  href: string | null;
  state: NotificationViewState;
  /** Set when state === "resolved". */
  resolvedAs?: NotificationResolvedAs;
  /** Empty unless state === "actionable". */
  availableActions: NotificationActionKind[];
}

/**
 * The inline actions notifications.act performs. reply_message is not one: the web posts the reply
 * through the conversation context directly.
 */
export type NotificationActAction = Exclude<
  NotificationActionKind,
  "reply_message"
>;

/** notifications.act's result: the row's resolved state after the action. */
export interface NotificationActResult {
  resolvedAs: NotificationResolvedAs;
}

/**
 * The ConvexError data notifications.act throws when the action is no longer available (done
 * elsewhere, withdrawn, grouped row). `resolvedAs` is the row's current resolved state, when it has
 * one; the UI renders that chip instead of an error.
 */
export type NotificationActionStaleError = {
  code: "NOTIFICATION_ACTION_STALE";
  resolvedAs?: NotificationResolvedAs;
};

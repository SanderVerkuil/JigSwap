import type {
  NotificationActionKind,
  NotificationResolvedAs,
  NotificationViewState,
} from "@jigswap/contracts";
import type { NotificationSubject, NotificationType } from "@jigswap/domain";

// Pure decision rules of the notification read model: given facts the loader has already read
// (resolveNotificationView.ts), decide actor visibility, state/resolvedAs/availableActions and the
// deep link. No database access here, so notifications.act and the email/push renderers can reuse
// the exact same decisions.

/** Admin-only types: a viewer who is no longer an admin never sees them. */
export const ADMIN_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  "admin_proposal_filed",
  "admin_definition_submitted",
]);

/**
 * Types whose actor contacted the viewer (or answered the viewer) through the notification itself:
 * follower, requester, approver, inviter, invitee, messenger, reviewer. Their identity is shown
 * even when their profile is private (the viewer already learned it from the interaction, like
 * listIncomingFollowRequests / listMyHouseholdInvites).
 *
 * Trade types are deliberately NOT here: their actor is a trade counterparty, resolved by the
 * per-trade rule (TRADE_NOTIFICATION_TYPES).
 *
 * Circle invite types are deliberately NOT here either: their actor goes through the ordinary
 * public / mutual rule, matching the projectMemberIdentity reveal the invite lists use.
 */
export const INITIATOR_NOTIFICATION_TYPES: ReadonlySet<NotificationType> =
  new Set([
    "message_received",
    "review_received",
    "new_follower",
    "follow_request_received",
    "follow_request_approved",
    "household_invite_received",
    "household_invite_accepted",
    "connection_offer_received",
  ]);

/**
 * Types about one exchange whose actor is the other party of it. The actor is resolved by the
 * PER-TRADE rule (exchange/tradeParty) for that exchange: visible by the ordinary rules, revealed
 * by this trade only (limited: no avatar), hidden, or departed. A reveal never leaks across trades.
 * When the exchange can't be resolved the ordinary public / mutual rule applies (fails closed).
 */
export const TRADE_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "exchange_disputed",
]);

/** Types whose deep link and actions target the actor (the actor IS the subject). */
const ACTOR_SUBJECT_TYPES: ReadonlySet<NotificationType> = new Set([
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
]);

export const isActorSubjectType = (type: NotificationType): boolean =>
  ACTOR_SUBJECT_TYPES.has(type);

export interface ActorFacts {
  /** The users row exists and `isActive` is true. */
  readonly active: boolean;
  readonly isViewer: boolean;
  /** The actor's profile visibility is public (an absent profile row counts as public). */
  readonly isPublic: boolean;
  readonly mutualFollowers: boolean;
  /**
   * A message_received whose sender the per-trade rule did not decide (a DM, or a thread /
   * exchange that no longer resolves). Its sender gets no initiator reveal: they are projected
   * like everywhere in the thread itself (self / public / mutual), so a private sender stays
   * anonymous. Fails closed. Required so no caller can omit it and fall back to the initiator
   * reveal.
   */
  readonly dmMessage: boolean;
}

/** Whether the viewer may see who the actor is. Deleted or deactivated actors are never shown. */
export const isActorRevealed = (
  type: NotificationType,
  facts: ActorFacts,
  viewerIsAdmin: boolean,
): boolean => {
  if (!facts.active) return false;
  if (facts.isViewer) return true;
  if (INITIATOR_NOTIFICATION_TYPES.has(type) && !facts.dmMessage) return true;
  if (ADMIN_NOTIFICATION_TYPES.has(type) && viewerIsAdmin) return true;
  return facts.isPublic || facts.mutualFollowers;
};

export interface ViewDecision {
  readonly state: NotificationViewState;
  readonly resolvedAs?: NotificationResolvedAs;
  readonly availableActions: NotificationActionKind[];
}

export const INFORMATIONAL: ViewDecision = {
  state: "informational",
  availableActions: [],
};
export const UNAVAILABLE: ViewDecision = {
  state: "unavailable",
  availableActions: [],
};
const resolved = (resolvedAs: NotificationResolvedAs): ViewDecision => ({
  state: "resolved",
  resolvedAs,
  availableActions: [],
});
const actionable = (actions: NotificationActionKind[]): ViewDecision => ({
  state: "actionable",
  availableActions: actions,
});

export interface FollowFacts {
  readonly actorFollowsViewer: boolean;
  readonly viewerFollowsActor: boolean;
  /** viewer -> actor request pending (a declined one still in cooldown masks as pending). */
  readonly viewerRequestPending: boolean;
}

/**
 * Follow back, for new_follower (toward the follower, only while they still follow the viewer) and
 * follow_request_approved (toward the approver). Already following or already requested resolves.
 */
export const decideFollowBack = (
  type: "new_follower" | "follow_request_approved",
  facts: FollowFacts,
): ViewDecision => {
  if (facts.viewerFollowsActor) {
    return resolved(
      facts.actorFollowsViewer ? "following_each_other" : "following",
    );
  }
  if (facts.viewerRequestPending) return resolved("requested");
  if (type === "new_follower" && !facts.actorFollowsViewer) {
    return INFORMATIONAL;
  }
  return actionable(["follow_back"]);
};

export interface FollowRequestFacts {
  /** The requester -> viewer request's status; null when it was withdrawn (removed). */
  readonly status: "pending" | "approved" | "declined" | null;
  readonly viewerFollowsRequester: boolean;
}

export const decideFollowRequest = (
  facts: FollowRequestFacts,
): ViewDecision => {
  switch (facts.status) {
    case "pending":
      return actionable([
        "approve_follow_request",
        ...(facts.viewerFollowsRequester
          ? []
          : (["approve_and_follow_back"] as const)),
        "decline_follow_request",
      ]);
    case "approved":
      return resolved("approved");
    case "declined":
      return resolved("declined");
    default:
      return resolved("expired");
  }
};

/** The invite's status when addressed to the viewer; null when gone or addressed to someone else. */
export const decideHouseholdInvite = (
  status: "pending" | "accepted" | "declined" | null,
): ViewDecision => {
  switch (status) {
    case "pending":
      return actionable([
        "accept_household_invite",
        "decline_household_invite",
      ]);
    case "accepted":
      return resolved("joined");
    case "declined":
      return resolved("declined");
    default:
      return resolved("expired");
  }
};

export const decideMessage = (isParticipant: boolean): ViewDecision =>
  isParticipant ? actionable(["reply_message"]) : UNAVAILABLE;

/** Grouped rows (several actors) never offer inline actions. */
export const withoutActionsWhenGrouped = (
  decision: ViewDecision,
  actorCount: number,
): ViewDecision =>
  actorCount > 1 && decision.state === "actionable" ? INFORMATIONAL : decision;

const TRADE_TYPES: ReadonlySet<NotificationType> = new Set([
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "exchange_proposed",
  "exchange_disputed",
]);

export const isTradeType = (type: NotificationType): boolean =>
  TRADE_TYPES.has(type);

/**
 * The deep link for a pre-ref row (no actorIds, no subject), keyed on `relatedId` exactly as the web
 * notification-meta `notificationHref` has always done, so legacy rows keep linking where they did.
 */
export const legacyNotificationHref = (
  type: NotificationType,
  relatedId: string | undefined,
): string | null => {
  switch (type) {
    case "trade_request":
    case "trade_accepted":
    case "trade_declined":
    case "trade_completed":
    case "trade_cancelled":
    case "exchange_proposed":
    case "exchange_disputed":
      return "/trades";
    case "message_received":
    case "circle_message_received":
    case "message_image_rejected":
      return relatedId ? `/messages/${relatedId}` : "/messages";
    case "review_received":
      return "/profile";
    case "goal_achieved":
      return "/goals";
    case "puzzle_favorited":
    case "puzzle_approved":
      return relatedId ? `/puzzles/${relatedId}` : "/puzzles";
    case "puzzle_rejected":
      return "/puzzles";
    case "photo_removed":
      return relatedId ? `/my-puzzles/${relatedId}` : "/my-puzzles";
    case "proposal_approved":
    case "proposal_rejected":
      return relatedId ? `/puzzles/${relatedId}` : "/puzzles";
    case "admin_proposal_filed":
      return relatedId
        ? `/admin/puzzles/proposals/${relatedId}`
        : "/admin/puzzles/proposals";
    case "admin_definition_submitted":
      return "/admin/moderation";
    case "new_follower":
    case "follow_request_received":
    case "follow_request_approved":
      return "/people";
    case "household_invite_received":
    case "household_invite_accepted":
      return "/household";
    // The offer is answered in the People page's requests area.
    case "connection_offer_received":
      return "/people";
    case "circle_invite_received":
    case "circle_invite_accepted":
    case "circle_deleted":
      return "/circles";
    case "whats_new":
      return relatedId ? `/whats-new#entry-${relatedId}` : "/whats-new";
    default:
      return null;
  }
};

export interface HrefInput {
  readonly type: NotificationType;
  readonly relatedId?: string;
  readonly subject?: NotificationSubject;
  /** The row carries refs (actorIds or subject); false means a legacy row. */
  readonly hasRefs: boolean;
  /** The first actor's handle; null when the actor is anonymous or absent. */
  readonly actorHandle: string | null;
  readonly actorCount: number;
  /** The subject still exists and the viewer may see it; false links to the parent list. */
  readonly subjectAvailable: boolean;
}

const seg = encodeURIComponent;

/** The single source of a notification's deep link. */
export const notificationHref = (input: HrefInput): string | null => {
  const { type, subject } = input;
  if (!input.hasRefs) return legacyNotificationHref(type, input.relatedId);

  if (isTradeType(type)) {
    return subject?.kind === "exchange" && input.subjectAvailable
      ? `/trades?exchange=${seg(subject.exchangeId)}`
      : "/trades";
  }
  if (isActorSubjectType(type)) {
    if (type === "new_follower" && input.actorCount > 1) return "/people";
    return input.actorHandle ? `/members/${seg(input.actorHandle)}` : null;
  }
  switch (type) {
    case "message_received":
    case "circle_message_received":
      return subject?.kind === "thread" && input.subjectAvailable
        ? `/messages/${seg(subject.threadId)}`
        : "/messages";
    case "puzzle_favorited":
    case "puzzle_approved":
    case "proposal_approved":
    case "proposal_rejected":
      return subject?.kind === "puzzle" && input.subjectAvailable
        ? `/puzzles/${seg(subject.puzzleId)}`
        : "/puzzles";
    case "photo_removed":
      return subject?.kind === "copy" && input.subjectAvailable
        ? `/my-puzzles/${seg(subject.copyId)}`
        : "/my-puzzles";
    case "admin_proposal_filed":
      return subject?.kind === "changeProposal"
        ? `/admin/puzzles/proposals/${seg(subject.proposalId)}`
        : "/admin/puzzles/proposals";
    case "whats_new":
      return subject?.kind === "whatsNew"
        ? `/whats-new#entry-${seg(subject.entryId)}`
        : "/whats-new";
    // While the invite is still open, deep-link it; otherwise the circles page.
    case "circle_invite_received":
      return subject?.kind === "circleInvite" && input.subjectAvailable
        ? `/circles?invite=${seg(subject.inviteId)}`
        : "/circles";
    default:
      return legacyNotificationHref(type, input.relatedId);
  }
};

/** First ~80 characters of a message body, whitespace-collapsed, with an ellipsis when cut. */
export const MESSAGE_PREVIEW_LENGTH = 80;
export const messagePreviewOf = (body: string): string | undefined => {
  const text = body.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length <= MESSAGE_PREVIEW_LENGTH
    ? text
    : `${text.slice(0, MESSAGE_PREVIEW_LENGTH - 1).trimEnd()}…`;
};

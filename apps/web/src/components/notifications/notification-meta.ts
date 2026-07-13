import {
  ArrowLeftRight,
  Bell,
  CheckCircle2,
  Heart,
  ImageOff,
  Inbox,
  Lightbulb,
  type LucideIcon,
  MessageSquare,
  Star,
  Target,
  UserCheck,
  UserPlus,
  XCircle,
} from "lucide-react";

// The notification `type` literals the backend emits (kept in sync with the domain
// NotificationType union surfaced by updateNotificationPreference). Centralised here so the bell,
// the list page, and the preference matrix all agree on icon, accent, and routing.
export type NotificationType =
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
  | "follow_request_approved";

export const NOTIFICATION_TYPES: NotificationType[] = [
  "trade_request",
  "trade_accepted",
  "trade_declined",
  "trade_completed",
  "trade_cancelled",
  "exchange_proposed",
  "exchange_disputed",
  "message_received",
  "review_received",
  "puzzle_favorited",
  "puzzle_approved",
  "puzzle_rejected",
  "photo_removed",
  "goal_achieved",
  "proposal_approved",
  "proposal_rejected",
  "admin_proposal_filed",
  "admin_definition_submitted",
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
];

// Types only admins ever receive; hidden from non-admin preference matrices.
export const ADMIN_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  "admin_proposal_filed",
  "admin_definition_submitted",
]);

// Types the backend will actually deliver by email (mirror of the domain's EMAIL_ELIGIBLE_TYPES —
// packages/domain/src/notifications/domain/notification-type.ts; keep in sync by hand). The matrix
// greys out the email switch for everything else: the server ignores the toggle regardless, this
// just keeps the UI honest.
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

export type NotificationChannel = "inApp" | "email" | "push";

export const NOTIFICATION_CHANNELS: NotificationChannel[] = [
  "inApp",
  "email",
  "push",
];

// A row as it reaches the UI. The list query returns full Convex docs; we read only this subset.
// `aggregateId` is the domain id markRead expects; legacy rows may lack it, so callers fall back.
export interface NotificationRow {
  _id: string;
  aggregateId?: string;
  type: string;
  title?: string;
  message?: string;
  params?: Record<string, string>;
  relatedId?: string;
  channel?: string;
  isRead: boolean;
  createdAt: number;
}

// The id markNotificationRead expects: the aggregateId, with a fallback to the Convex _id for
// pre-domain rows that were backfilled without one.
export function notificationId(row: NotificationRow): string {
  return row.aggregateId ?? row._id;
}

// Localized title + message for a notification, rendered from its `type` via the
// `notifications.copy.<type>` i18n keys. The stored `title`/`message` only exist on legacy rows
// (predating the type+params model), so they're only a fallback for an unknown/legacy type.
// `t` is a `useTranslations("notifications")` translator.
export function notificationCopy(
  row: NotificationRow,
  t: (key: string) => string,
): { title: string; message: string } {
  if ((NOTIFICATION_TYPES as string[]).includes(row.type)) {
    return {
      title: t(`copy.${row.type}.title`),
      message: t(`copy.${row.type}.message`),
    };
  }
  return { title: row.title ?? "", message: row.message ?? "" };
}

export function notificationIcon(type: string): LucideIcon {
  switch (type) {
    case "trade_request":
    case "trade_accepted":
    case "trade_declined":
    case "trade_completed":
    case "trade_cancelled":
    case "exchange_proposed":
      return ArrowLeftRight;
    case "exchange_disputed":
      return XCircle;
    case "message_received":
      return MessageSquare;
    case "review_received":
      return Star;
    case "puzzle_favorited":
      return Heart;
    case "goal_achieved":
      return Target;
    case "puzzle_approved":
      return CheckCircle2;
    case "puzzle_rejected":
      return XCircle;
    case "photo_removed":
      return ImageOff;
    case "proposal_approved":
      return CheckCircle2;
    case "proposal_rejected":
      return XCircle;
    case "admin_proposal_filed":
      return Lightbulb;
    case "admin_definition_submitted":
      return Inbox;
    case "new_follower":
    case "follow_request_received":
      return UserPlus;
    case "follow_request_approved":
      return UserCheck;
    default:
      return Bell;
  }
}

// Tailwind colour token for the type's icon, mirroring the accent colours used elsewhere
// (e.g. the profile recent-activity list). Purely decorative.
export function notificationAccent(type: string): string {
  switch (type) {
    case "trade_completed":
    case "trade_accepted":
    case "puzzle_approved":
    case "proposal_approved":
    case "follow_request_approved":
      return "text-green-600";
    case "trade_declined":
    case "trade_cancelled":
    case "exchange_disputed":
    case "puzzle_rejected":
    case "photo_removed":
    case "proposal_rejected":
      return "text-destructive";
    case "review_received":
    case "goal_achieved":
      return "text-yellow-600";
    case "puzzle_favorited":
      return "text-pink-500";
    case "message_received":
      return "text-blue-500";
    case "new_follower":
    case "follow_request_received":
      return "text-blue-500";
    case "admin_proposal_filed":
    case "admin_definition_submitted":
      return "text-primary";
    default:
      return "text-primary";
  }
}

// Where clicking a notification should take the member, when it carries a sensible related entity.
// Returns null when there is no useful destination (we then just mark it read). The puzzle route is
// only used when relatedId looks like a puzzle/copy id the puzzle detail page can resolve.
export function notificationHref(row: NotificationRow): string | null {
  const { type, relatedId } = row;
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
      // relatedId carries the thread aggregateId (see the contracts docstring),
      // which is exactly what /messages/$threadId resolves.
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
    // relatedId is the copy the photo belonged to; /my-puzzles/$id is the
    // owner's view of that copy.
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
    // Follow activity resolves on the People page (requests strip + network grid).
    case "new_follower":
    case "follow_request_received":
    case "follow_request_approved":
      return "/people";
    default:
      return null;
  }
}

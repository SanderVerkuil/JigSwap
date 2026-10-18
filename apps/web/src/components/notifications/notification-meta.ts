import {
  ArrowLeftRight,
  Bell,
  CheckCircle2,
  Heart,
  House,
  ImageOff,
  Inbox,
  Lightbulb,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Star,
  Target,
  UserCheck,
  UserPlus,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";

// The notification `type` literals the backend emits (kept in sync with the domain
// NotificationType union surfaced by updateNotificationPreference). Centralised here so the bell,
// the list page, and the preference matrix all agree on icon and accent (links are server-computed).
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
  | "follow_request_approved"
  | "household_invite_received"
  | "household_invite_accepted"
  | "connection_offer_received"
  | "circle_invite_received"
  | "circle_invite_accepted"
  | "whats_new"
  | "report_decided"
  | "content_removed"
  | "member_warned";

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
  "household_invite_received",
  "household_invite_accepted",
  "connection_offer_received",
  "circle_invite_received",
  "circle_invite_accepted",
  "whats_new",
  "report_decided",
  "content_removed",
  "member_warned",
];

// Types only admins ever receive; hidden from non-admin preference matrices.
export const ADMIN_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  "admin_proposal_filed",
  "admin_definition_submitted",
]);

export type NotificationCategoryKey =
  | "trades"
  | "messages"
  | "social"
  | "submissions"
  | "product"
  | "safety"
  | "admin";

export interface NotificationCategory {
  readonly key: NotificationCategoryKey;
  readonly types: readonly NotificationType[];
}

// Display grouping for the preferences matrix. Every NotificationType appears in EXACTLY one
// category (pinned by notification-meta.test.ts). `admin` stays hidden for non-admins via the
// existing ADMIN_NOTIFICATION_TYPES filtering.
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  {
    key: "trades",
    types: [
      "trade_request",
      "trade_accepted",
      "trade_declined",
      "trade_completed",
      "trade_cancelled",
      "exchange_proposed",
      "exchange_disputed",
    ],
  },
  { key: "messages", types: ["message_received"] },
  {
    key: "social",
    types: [
      "new_follower",
      "follow_request_received",
      "follow_request_approved",
      "household_invite_received",
      "household_invite_accepted",
      "connection_offer_received",
      "circle_invite_received",
      "circle_invite_accepted",
      "puzzle_favorited",
      "review_received",
      "goal_achieved",
    ],
  },
  {
    key: "submissions",
    types: [
      "puzzle_approved",
      "puzzle_rejected",
      "proposal_approved",
      "proposal_rejected",
      "photo_removed",
    ],
  },
  // Product news gets its own row so members can mute it without muting social activity.
  { key: "product", types: ["whats_new"] },
  // Report outcomes and moderation of the member's own content (DSA notices).
  {
    key: "safety",
    types: ["report_decided", "content_removed", "member_warned"],
  },
  {
    key: "admin",
    types: ["admin_proposal_filed", "admin_definition_submitted"],
  },
];

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
  "circle_invite_received",
]);

export type NotificationChannel = "inApp" | "email" | "push";

// Types always delivered in-app (mirror of the domain's MANDATORY_IN_APP_TYPES — keep in sync by
// hand): the DSA Art. 17 statement of reasons must reach the member whatever their preference. The
// matrix shows their in-app switch on and disabled; push and email stay toggleable.
export const MANDATORY_IN_APP_TYPES: ReadonlySet<NotificationType> = new Set([
  "content_removed",
  "member_warned",
]);

export const NOTIFICATION_CHANNELS: NotificationChannel[] = [
  "inApp",
  "email",
  "push",
];

// What the legacy copy renders from: the type, its params snapshot, and (for a type the web no longer
// knows) the stored title/message.
export interface NotificationCopySource {
  type: string;
  title?: string;
  message?: string;
  params?: Record<string, string>;
}

// The params the subscriber stores on a row (see packages/backend/convex/notifications/subscriber.ts).
const COPY_PARAMS = [
  "actorName",
  "puzzleTitle",
  "goalTitle",
  "reason",
] as const;

// ICU values for `copy.<type>.message`. Every param is always present (empty when the row lacks
// it) alongside a `has<Param>` "yes"/"no" flag the messages `select` on, so older rows without a
// value render the generic sentence instead of a blank or "undefined".
function copyValues(
  params: Record<string, string> | undefined,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of COPY_PARAMS) {
    const value = params?.[key]?.trim() ?? "";
    values[key] = value;
    values[`has${key[0].toUpperCase()}${key.slice(1)}`] = value ? "yes" : "no";
  }
  return values;
}

// Localized title + message for a notification, rendered from its `type` via the
// `notifications.copy.<type>` i18n keys: the fallback for rows without actor/subject refs (the rich
// `notifications.rich.<type>` sentences need them). The stored `title`/`message` only exist on
// legacy rows (predating the type+params model), so they're only a fallback for an unknown type.
// `t` is a `useTranslations("notifications")` translator.
export function notificationCopy(
  row: NotificationCopySource,
  t: (key: string, values?: Record<string, string>) => string,
): { title: string; message: string } {
  if ((NOTIFICATION_TYPES as string[]).includes(row.type)) {
    return {
      title: t(`copy.${row.type}.title`),
      message: t(`copy.${row.type}.message`, copyValues(row.params)),
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
    case "connection_offer_received":
      return UserPlus;
    case "follow_request_approved":
      return UserCheck;
    case "household_invite_received":
    case "household_invite_accepted":
      return House;
    case "circle_invite_received":
    case "circle_invite_accepted":
      return Users;
    case "whats_new":
      return Sparkles;
    case "report_decided":
      return ShieldCheck;
    case "content_removed":
      return ShieldX;
    case "member_warned":
      return ShieldAlert;
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
    case "household_invite_accepted":
    case "circle_invite_accepted":
      return "text-green-600 dark:text-green-400";
    case "trade_declined":
    case "trade_cancelled":
    case "exchange_disputed":
    case "puzzle_rejected":
    case "photo_removed":
    case "proposal_rejected":
    case "content_removed":
      return "text-destructive";
    case "member_warned":
      return "text-jigsaw-warning";
    case "review_received":
    case "goal_achieved":
      return "text-yellow-600 dark:text-yellow-400";
    case "puzzle_favorited":
      return "text-pink-500";
    case "message_received":
      return "text-blue-500 dark:text-blue-400";
    case "new_follower":
    case "follow_request_received":
    case "household_invite_received":
    case "connection_offer_received":
    case "circle_invite_received":
      return "text-blue-500 dark:text-blue-400";
    case "admin_proposal_filed":
    case "admin_definition_submitted":
      return "text-primary-text";
    // Brand violet, matching the What's new feature chip.
    case "whats_new":
      return "text-jigsaw-primary";
    default:
      return "text-primary-text";
  }
}

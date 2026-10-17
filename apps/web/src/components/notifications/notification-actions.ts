import type {
  NotificationActionKind,
  NotificationView,
  NotificationViewType,
} from "@jigswap/contracts";
import {
  Check,
  MessageSquare,
  UserCheck,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";

export type NotificationSurface = "popover" | "page";

export interface ActionMeta {
  /** `notifications.rich.<type>.actions.<labelKey>`; `<labelKey>Aria` and `<labelKey>Error` sit beside it. */
  readonly labelKey: string;
  readonly variant: "default" | "outline" | "ghost";
  readonly icon: LucideIcon;
}

export const ACTION_META: Record<NotificationActionKind, ActionMeta> = {
  follow_back: { labelKey: "followBack", variant: "default", icon: UserPlus },
  approve_follow_request: {
    labelKey: "approve",
    variant: "default",
    icon: Check,
  },
  approve_and_follow_back: {
    labelKey: "approveAndFollowBack",
    variant: "outline",
    icon: UserCheck,
  },
  decline_follow_request: { labelKey: "decline", variant: "ghost", icon: X },
  accept_household_invite: {
    labelKey: "accept",
    variant: "default",
    icon: Check,
  },
  decline_household_invite: { labelKey: "decline", variant: "ghost", icon: X },
  reply_message: {
    labelKey: "reply",
    variant: "outline",
    icon: MessageSquare,
  },
};

// The popover only offers the low-stakes decisions inline: follow, follow-request and household.
const POPOVER_ACTION_TYPES: ReadonlySet<NotificationViewType> = new Set([
  "new_follower",
  "follow_request_received",
  "follow_request_approved",
  "household_invite_received",
]);

// Actions that live behind the row's overflow menu on the page (never inline, never in the popover).
const OVERFLOW_ACTIONS: ReadonlySet<NotificationActionKind> = new Set([
  "approve_and_follow_back",
]);

/** Which of the view's available actions render inline, and which go in the page's overflow menu. */
export function actionsFor(
  view: Pick<NotificationView, "type" | "availableActions">,
  surface: NotificationSurface,
): { inline: NotificationActionKind[]; overflow: NotificationActionKind[] } {
  const inline = view.availableActions.filter((a) => !OVERFLOW_ACTIONS.has(a));
  if (surface === "popover") {
    return POPOVER_ACTION_TYPES.has(view.type)
      ? { inline: inline.slice(0, 2), overflow: [] }
      : { inline: [], overflow: [] };
  }
  return {
    inline,
    overflow: view.availableActions.filter((a) => OVERFLOW_ACTIONS.has(a)),
  };
}

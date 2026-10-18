import { useMemberDisplayName } from "@/lib/member-display-name";
import type {
  NotificationActorView,
  NotificationView,
  NotificationViewType,
} from "@jigswap/contracts";
import { useCallback, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { notificationCopy } from "./notification-meta";

// Types with no producer (exchange_proposed, puzzle_favorited) and What's new keep the stored copy.
const LEGACY_ONLY: ReadonlySet<NotificationViewType> = new Set([
  "exchange_proposed",
  "puzzle_favorited",
  "whats_new",
]);

// Rich sentences that name no actor (the moderator is never shown on moderation outcomes).
const ACTORLESS: ReadonlySet<NotificationViewType> = new Set([
  "goal_achieved",
  "puzzle_approved",
  "puzzle_rejected",
  "proposal_approved",
  "proposal_rejected",
  "photo_removed",
]);

/**
 * Localized name for an actor: "Former member" when anonymous (deleted, deactivated), the generic
 * "Puzzler" when they have no name, else their resolved name.
 */
export function useActorName(): (
  actor: NotificationActorView | undefined,
) => string {
  const t = useTranslations("notifications.rich");
  const displayName = useMemberDisplayName();
  return useCallback(
    (actor) =>
      !actor || actor.anonymous
        ? t("formerMember")
        : displayName({ name: actor.name }),
    [t, displayName],
  );
}

const bold = (chunks: ReactNode) => (
  <strong className="text-foreground font-semibold">{chunks}</strong>
);

/** The notification's sentence, actor and subject in bold. Legacy rows fall back to the N0 copy. */
export function NotificationSentence({ view }: { view: NotificationView }) {
  const t = useTranslations("notifications");
  const memberName = useActorName();
  const displayName = useMemberDisplayName();
  const { type, actors, actorCount, context } = view;
  // An anonymous, not-departed trade party is a living member hidden by privacy (e.g. an owner who
  // declined without replying), not a former one: name them with the generic member label.
  const actorName = (actor: NotificationActorView | undefined) =>
    type.startsWith("trade_") && actor?.anonymous && !actor.departed
      ? displayName(null)
      : memberName(actor);

  if (LEGACY_ONLY.has(type) || (!ACTORLESS.has(type) && actors.length === 0)) {
    // Ref-less (pre-N2) row: only the stored params snapshot is left; the server exposes the
    // stored actor name for types that may name their actor.
    const params: Record<string, string> = {};
    if (context.actorNameSnapshot) params.actorName = context.actorNameSnapshot;
    if (context.puzzleTitle) params.puzzleTitle = context.puzzleTitle;
    if (context.goalTitle) params.goalTitle = context.goalTitle;
    if (context.reason) params.reason = context.reason;
    return <>{notificationCopy({ type, params }, t).message}</>;
  }

  // A privacy-hidden (living) message sender is not a "Former member": a nameless sentence.
  if (
    type === "message_received" &&
    actors[0]?.anonymous &&
    !actors[0].departed
  ) {
    return <>{t("rich.message_received.sentenceAnonymous")}</>;
  }

  const values = {
    actor: actorName(actors[0]),
    actor2: actorName(actors[1]),
    others: Math.max(0, actorCount - 2),
    puzzle: context.puzzleTitle ?? "",
    hasPuzzle: context.puzzleTitle ? "yes" : "no",
    goal: context.goalTitle ?? "",
    hasGoal: context.goalTitle ? "yes" : "no",
    // message_received: a photo or shared location is named by its kind, never its caption.
    media: context.messageKind ?? "none",
    b: bold,
  };
  const key =
    type === "new_follower" && actorCount >= 2 && actors.length >= 2
      ? "sentenceGrouped"
      : "sentence";
  return <>{t.rich(`rich.${type}.${key}`, values)}</>;
}

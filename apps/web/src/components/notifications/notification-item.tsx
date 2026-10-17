"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/ui/star-rating";
import { useDateFnsLocale } from "@/lib/date-locale";
import { cn } from "@/lib/utils";
import type {
  NotificationExchangeStatus,
  NotificationView,
} from "@jigswap/contracts";
import { Link as RouterLink } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { NotificationActions } from "./notification-action-row";
import type { NotificationSurface } from "./notification-actions";
import { NotificationActor } from "./notification-actor";
import { NotificationSentence, useActorName } from "./notification-sentence";
import { NotificationThumb } from "./notification-thumb";
import { RequesterPreview } from "./requester-preview";

// The stretched row target: the link's ::after covers the whole <li>, so the row is clickable
// without nesting the actions inside it (they sit above it with `relative z-10`). ring-inset keeps
// the focus ring inside the popover's scroll clip.
const STRETCHED =
  "after:absolute after:inset-0 after:z-[1] after:content-[''] focus-visible:outline-none focus-visible:after:ring-[3px] focus-visible:after:ring-inset focus-visible:after:ring-ring/50";

/** Split a server href ("/trades?exchange=x", "/whats-new#entry-y") into router link parts. */
export function hrefParts(href: string): {
  to: string;
  search?: Record<string, string>;
  hash?: string;
} {
  const url = new URL(href, "http://local");
  const search = Object.fromEntries(url.searchParams);
  return {
    to: url.pathname,
    ...(Object.keys(search).length > 0 ? { search } : {}),
    ...(url.hash ? { hash: url.hash.slice(1) } : {}),
  };
}

// Same tones as the /trades status pill.
const STATUS_TONES: Partial<Record<NotificationExchangeStatus, string>> = {
  proposed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  accepted: "bg-jigsaw-primary/10 text-jigsaw-primary",
  disputed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  completed: "bg-green-500/15 text-green-700 dark:text-green-400",
};

function ExchangeStatusChip({
  status,
}: {
  status: NotificationExchangeStatus;
}) {
  const t = useTranslations("trades.status");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        STATUS_TONES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {t(status)}
    </span>
  );
}

/**
 * One notification row, shared by the bell popover and the full page. Valid DOM: a stretched row
 * link (or, for an unread row without a destination, a stretched mark-read button) with the
 * actions, preview disclosure and mark-read button as siblings above it.
 */
export function NotificationItem({
  view,
  surface,
  onOpen,
  onMarkRead,
  categoryLabel,
}: {
  view: NotificationView;
  surface: NotificationSurface;
  /** Called when the row is opened (mark read, close the popover). */
  onOpen: (view: NotificationView) => void;
  /** Page only: the mark-read button. */
  onMarkRead?: (view: NotificationView) => void;
  /** Page only: the category badge in the meta line. */
  categoryLabel?: string;
}) {
  const t = useTranslations("notifications");
  const dateLocale = useDateFnsLocale();
  const actorName = useActorName();
  const { context } = view;
  const unread = !view.isRead;
  const unavailable = view.state === "unavailable";
  const contextId = `ctx-${view.id}`;
  const actor = view.actors[0];
  const pendingRequester =
    view.type === "follow_request_received" &&
    view.state === "actionable" &&
    actor !== undefined &&
    !actor.anonymous
      ? actor
      : null;

  const sentence = (
    <>
      {unread && <span className="sr-only">{t("rich.unread")}</span>}
      <NotificationSentence view={view} />
    </>
  );

  const contextParts: ReactNode[] = [];
  if (unavailable) {
    contextParts.push(<span key="unavailable">{t("rich.unavailable")}</span>);
  } else if (context.exchangeStatus) {
    contextParts.push(
      <ExchangeStatusChip key="status" status={context.exchangeStatus} />,
    );
  }
  if (context.messagePreview) {
    contextParts.push(
      <span key="preview" className="line-clamp-2">
        {t("rich.context.messagePreview", { preview: context.messagePreview })}
      </span>,
    );
  }
  if (context.reason) {
    contextParts.push(
      <span key="reason" className="line-clamp-2">
        {t("rich.context.reason", { reason: context.reason })}
      </span>,
    );
  }
  if (context.rating) {
    contextParts.push(
      <StarRating
        key="rating"
        value={context.rating}
        size="sm"
        label={t("rich.context.rating", { rating: context.rating })}
      />,
    );
  }
  // The bell has no room for the preview disclosure: name the handle the row link opens.
  if (
    pendingRequester &&
    surface === "popover" &&
    pendingRequester.handle !== pendingRequester.memberId
  ) {
    contextParts.push(<span key="handle">@{pendingRequester.handle}</span>);
  }

  const parts = view.href ? hrefParts(view.href) : null;

  return (
    <li
      className={cn(
        "group relative flex items-start gap-3 px-4 py-3 transition-colors motion-reduce:transition-none",
        "has-[[data-row-link]:hover]:bg-accent/60",
        unread && "bg-accent/40 dark:bg-accent/60",
        unavailable && "opacity-70",
      )}
    >
      {unread && (
        <span
          aria-hidden="true"
          className="bg-primary absolute inset-y-0 left-0 w-0.5"
        />
      )}
      <NotificationActor
        actors={view.actors}
        actorCount={view.actorCount}
        type={view.type}
        surface={surface}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p
          className={cn(
            "text-sm leading-snug [overflow-wrap:anywhere]",
            unread ? "font-medium" : "text-muted-foreground",
          )}
        >
          {parts ? (
            <RouterLink
              data-row-link=""
              to={parts.to}
              search={parts.search as never}
              hash={parts.hash}
              aria-describedby={contextParts.length > 0 ? contextId : undefined}
              className={STRETCHED}
              onClick={() => onOpen(view)}
            >
              {sentence}
            </RouterLink>
          ) : unread ? (
            <button
              type="button"
              data-row-link=""
              className={cn("text-left", STRETCHED)}
              onClick={() => onOpen(view)}
            >
              {sentence}
            </button>
          ) : (
            sentence
          )}
        </p>
        {contextParts.length > 0 && (
          <div
            id={contextId}
            className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          >
            {contextParts}
          </div>
        )}
        <p className="text-muted-foreground flex items-center gap-2 text-[11px]">
          <time dateTime={new Date(view.createdAt).toISOString()}>
            {formatDistanceToNow(new Date(view.createdAt), {
              addSuffix: true,
              locale: dateLocale,
            })}
          </time>
          {categoryLabel && (
            <Badge variant="outline" className="text-[10px]">
              {categoryLabel}
            </Badge>
          )}
        </p>
        <div className="relative z-10 pt-1 empty:hidden">
          <NotificationActions view={view} surface={surface} />
        </div>
        {pendingRequester && surface === "page" && (
          <RequesterPreview
            requesterId={pendingRequester.memberId}
            actorName={actorName(pendingRequester)}
          />
        )}
      </div>
      <NotificationThumb url={context.thumbnailUrl} unavailable={unavailable} />
      {onMarkRead && unread && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative z-10 size-8 shrink-0 pointer-coarse:size-11"
          onClick={() => onMarkRead(view)}
          aria-label={t("markRead")}
          title={t("markRead")}
        >
          <Check className="size-4" aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}

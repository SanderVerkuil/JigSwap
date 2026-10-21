"use client";

// Inbox pane of /messages: the reactive getMyInbox subscription rendered as a
// list of fixed-height conversation rows (message-center redesign spec §3–§4).
// All data access lives in the messaging components; routes stay thin.
import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { EmptyState } from "@/components/library/empty-state";
import { MemberInitial } from "@/components/members/member-initial";
import { PresenceDot } from "@/components/presence/presence-dot";
import { PresenceSharePrompt } from "@/components/presence/presence-sharing";
import {
  usePresenceOf,
  type PresenceStatus,
} from "@/components/presence/use-presence";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { stripFormatting } from "@jigswap/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, BellOff, User, UserRound } from "lucide-react";
import { useState } from "react";
import { useLocale, useNow, useTranslations } from "use-intl";
import { CircleThreadAvatar } from "./circle-thread-avatar";
import { CoverTooltipProvider, RowCover } from "./cover-stack";
import {
  anonymousLabel,
  circleSnippet,
  copyOwnerHint,
  coverStackSummary,
  formatCompactTime,
  formatFullDateTime,
  formatUnreadCount,
  threadSubjectTitle,
  tradeEventText,
  type AnyInboxThread,
  type InboxThread,
  type Translator,
} from "./format";

// The revealed partner of a DM row, the only rows that carry a presence dot
// (exchange rows show an exchange chip, circle rows their members).
function dmPartnerId(thread: AnyInboxThread): string | undefined {
  const { subject } = thread;
  return subject.kind === "dm" && !subject.otherMember.anonymous
    ? subject.otherMember.member._id
    : undefined;
}

// Avatar chip for a thread subject: the member's avatar/initials for a
// revealed DM partner, a generic person glyph for an anonymised one, an
// exchange icon chip for exchange threads, and the members for a circle.
export function ThreadSubjectAvatar({
  subject,
  className = "size-10",
}: {
  subject: AnyInboxThread["subject"];
  className?: string;
}) {
  if (subject.kind === "circle") {
    return (
      <CircleThreadAvatar
        members={subject.memberPreview}
        className={className}
      />
    );
  }
  if (subject.kind === "dm" && !subject.otherMember.anonymous) {
    return (
      // Decorative: the name always sits right next to it.
      <Avatar aria-hidden className={cn("shrink-0", className)}>
        {subject.otherMember.member.avatar && (
          <AvatarImage src={subject.otherMember.member.avatar} alt="" />
        )}
        <AvatarFallback>
          <MemberInitial source={subject.otherMember.member} />
        </AvatarFallback>
      </Avatar>
    );
  }
  const Icon = subject.kind === "exchange" ? ArrowLeftRight : User;
  return (
    <span
      aria-hidden
      className={cn(
        "bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-full",
        className,
      )}
    >
      <Icon className="size-[18px]" />
    </span>
  );
}

// The list pane: loading / error / empty / rows. The page head titles the
// page and carries the New menu (published by the /messages layout).
export function ThreadList({ activeThreadId }: { activeThreadId?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Desktop scrolls inside the frame; mobile scrolls the document. */}
      <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
        {/* One-time "show when you're online?" card, until the member chooses. */}
        <PresenceSharePrompt />
        <ThreadListBody activeThreadId={activeThreadId} />
      </div>
    </div>
  );
}

function ThreadListBody({ activeThreadId }: { activeThreadId?: string }) {
  const t = useTranslations("messages");
  const locale = useLocale();
  // One clock for every row, ticking each minute so "now"/"5m" stay fresh.
  const now = useNow({ updateInterval: 60_000 }).getTime();
  const { member } = useCurrentMember();
  const me = member?._id;
  const {
    data: inbox,
    isError,
    refetch,
  } = useQuery(convexQuery(gateway.conversation.getMyInbox, me ? {} : "skip"));
  // One presence subscription for the list: DM partners, most recent first (exchange rows show
  // an exchange chip, not the partner's avatar, so they carry no dot).
  const presence = usePresenceOf(inbox?.map(dmPartnerId) ?? []);

  if (isError) {
    return (
      <div className="p-6 text-center text-sm">
        <p>{t("inboxError")}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => void refetch()}
        >
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (inbox === undefined) {
    return (
      <div className="flex flex-col gap-0.5 p-2 max-md:-mx-2" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex h-[68px] items-center gap-3 px-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="ml-auto h-3 w-8" />
              </div>
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (inbox.length === 0) {
    return (
      <div className="px-4">
        <EmptyState
          title={t("empty")}
          sub={t("emptyHint")}
          action={
            <Button asChild variant="brand">
              <Link href="/people">
                <UserRound className="h-4 w-4" />
                {t("circle.messageMember")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <CoverTooltipProvider>
      <nav aria-label={t("conversationsLabel")}>
        <ul role="list" className="flex flex-col gap-0.5 p-2 max-md:-mx-2">
          {inbox.map((thread) => (
            <li key={thread.threadId}>
              <ThreadRow
                thread={thread}
                selected={thread.threadId === activeThreadId}
                presence={presence.get(dmPartnerId(thread) ?? "")}
                now={now}
                locale={locale}
                meId={me}
              />
            </li>
          ))}
        </ul>
      </nav>
    </CoverTooltipProvider>
  );
}

// One conversation: avatar, then two baseline-aligned lines — name + compact
// time, snippet + unread badge. Fixed 68px so rows (and skeletons) line up.
// A muted thread shows a bell-off before the time and a grey count.
function ThreadRow({
  thread,
  selected,
  presence,
  now,
  locale,
  meId,
}: {
  thread: AnyInboxThread;
  selected: boolean;
  /** The DM partner's status when the viewer may see it. */
  presence: PresenceStatus | undefined;
  now: number;
  locale: string;
  meId: string | undefined;
}) {
  const t = useTranslations("messages");
  const tSafety = useTranslations("safety");
  const displayName = useMemberDisplayName();
  // Keyboard (focus-visible) focus on the row: the row's cover lifts and
  // names itself, as hovering it does.
  const [keyboardFocused, setKeyboardFocused] = useState(false);

  const unread = thread.unreadCount > 0;
  const muted = thread.muted === true;
  // A muted thread's unread state doesn't call for attention.
  const highlighted = unread && !muted;
  const last = thread.lastMessage;
  const isSystem = last?.kind === "system";
  const fullTime = formatFullDateTime(thread.updatedAt, locale);
  // muted-foreground on the selected tint is < 4.5:1; darken it there.
  const mutedText = selected ? "text-foreground/75" : "text-muted-foreground";
  const subject = thread.subject;

  const snippet =
    subject.kind === "circle"
      ? circleSnippet(last, meId, t, displayName, tSafety("messageRemoved"))
      : pairSnippet(
          thread as InboxThread,
          t,
          tSafety("messageRemoved"),
          displayName,
        );
  const contextCopies = subject.kind === "circle" ? [] : thread.contextCopies;

  return (
    <Link
      href={`/messages/${thread.threadId}`}
      aria-current={selected ? "page" : undefined}
      onFocus={(event) =>
        setKeyboardFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setKeyboardFocused(false)}
      className={cn(
        "group focus-visible:ring-ring relative flex h-[68px] items-center gap-3 rounded-lg px-3 outline-none transition-colors focus-visible:ring-2",
        selected
          ? "bg-jigsaw-primary-tint hover:bg-jigsaw-primary-tint"
          : "hover:bg-muted/60",
      )}
    >
      {selected && (
        <span
          aria-hidden
          className="bg-primary absolute inset-y-3 left-0 w-[3px] rounded-full"
        />
      )}
      <span className="relative flex shrink-0">
        <ThreadSubjectAvatar subject={subject} />
        <PresenceDot status={presence} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-foreground min-w-0 flex-1 truncate text-sm leading-5",
              highlighted ? "font-bold" : "font-medium",
            )}
          >
            {subject.kind === "circle" && (
              <span className="sr-only">{t("circle.circleChat")}: </span>
            )}
            {threadSubjectTitle(subject, t, displayName)}
          </span>
          {muted && (
            <BellOff
              aria-hidden
              className={cn("size-3.5 shrink-0 self-center", mutedText)}
            />
          )}
          <time
            dateTime={new Date(thread.updatedAt).toISOString()}
            title={fullTime}
            aria-hidden
            className={cn(
              "shrink-0 text-xs leading-5 tabular-nums",
              highlighted ? "text-primary-text font-semibold" : mutedText,
            )}
          >
            {formatCompactTime(thread.updatedAt, now, locale, t)}
          </time>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] leading-5">
          {/* The most recent puzzle; the label summarises all of them. */}
          {subject.kind !== "circle" && contextCopies.length > 0 && (
            <RowCover
              copy={contextCopies[0]}
              label={coverStackSummary(
                contextCopies.map((copy) => copy.title),
                locale,
                t,
                1,
              )}
              keyboardFocused={keyboardFocused}
              describe={(copy) =>
                `${copy.title} · ${copyOwnerHint(
                  copy.owner,
                  subject.otherMember,
                  t,
                  displayName,
                )}`
              }
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              isSystem && "italic",
              highlighted && !isSystem
                ? "text-foreground font-medium"
                : mutedText,
            )}
          >
            {snippet}
          </span>
          {unread && (
            <span
              aria-hidden
              className={cn(
                "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
                muted
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {formatUnreadCount(thread.unreadCount)}
            </span>
          )}
        </div>
      </div>
      {/* The visual time, bell and pill are aria-hidden; announce the full forms instead. */}
      {muted && <span className="sr-only">{t("circle.muted")}</span>}
      {unread && (
        <span className="sr-only">
          {t("unreadCount", { count: thread.unreadCount })}
        </span>
      )}
      <span className="sr-only">{fullTime}</span>
    </Link>
  );
}

// An exchange or DM row's snippet: the newest message, "You: …" for the
// viewer's own, a photo or location named by its sender.
function pairSnippet(
  thread: InboxThread,
  t: Translator,
  removedLabel: string,
  displayName: ReturnType<typeof useMemberDisplayName>,
): string {
  const last = thread.lastMessage;
  // A trade lifecycle row reads in the viewer's language.
  if (last?.kind === "system" && last.tradeEvent) {
    return tradeEventText(last.tradeEvent, t);
  }
  // A removed message has an empty body: name the removal instead.
  const body = last?.removed
    ? removedLabel
    : last
      ? stripFormatting(last.body).replace(/\s+/g, " ").trim()
      : undefined;
  const mine = last?.isMine === true;
  // A photo without a caption names the sender instead of an empty body.
  const photoOnly = last?.kind === "image" && !last.removed && !body;
  // A location always names the sharer (its caption is not the point).
  const location = last?.kind === "location" && !last.removed;
  const otherName = thread.subject.otherMember.anonymous
    ? anonymousLabel(thread.subject.otherMember, t)
    : displayName(thread.subject.otherMember.member);
  return body === undefined
    ? t("noMessages")
    : location
      ? mine
        ? t("locations.youSharedALocation")
        : t("locations.sharedALocation", { name: otherName })
      : photoOnly
        ? mine
          ? t("photos.youSentAPhoto")
          : t("photos.sentAPhoto", {
              name: thread.subject.otherMember.anonymous
                ? t("anonymous")
                : displayName(thread.subject.otherMember.member),
            })
        : mine
          ? t("youPrefix", { body })
          : body;
}

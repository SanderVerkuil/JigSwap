"use client";

// Inbox pane of /messages: the reactive getMyInbox subscription rendered as a
// list of fixed-height conversation rows (message-center redesign spec §3–§4).
// All data access lives in the messaging components; routes stay thin.
import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, MessageSquare, User } from "lucide-react";
import { useState } from "react";
import { useLocale, useNow, useTranslations } from "use-intl";
import { CoverTooltipProvider, RowCover } from "./cover-stack";
import {
  copyOwnerHint,
  coverStackSummary,
  formatCompactTime,
  formatFullDateTime,
  formatUnreadCount,
  threadSubjectTitle,
  type InboxThread,
} from "./format";

// Avatar chip for a thread subject: the member's avatar/initials for a
// revealed DM partner, a generic person glyph for an anonymised one, and an
// exchange icon chip for exchange threads.
export function ThreadSubjectAvatar({
  subject,
  className = "size-10",
}: {
  subject: InboxThread["subject"];
  className?: string;
}) {
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

// The list pane: a md+ header ("Conversations", aligned with the thread
// header's rule), then loading / error / empty / rows. Mobile shows just the
// rows — the shell top bar already titles the page.
export function ThreadList({ activeThreadId }: { activeThreadId?: string }) {
  const t = useTranslations("messages");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hidden h-14 shrink-0 items-center border-b px-4 md:flex">
        <h2 className="font-heading text-base font-bold">
          {t("conversationsLabel")}
        </h2>
      </div>
      {/* Desktop scrolls inside the frame; mobile scrolls the document. */}
      <div className="md:min-h-0 md:flex-1 md:overflow-y-auto">
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
      <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
        <div className="bg-muted flex size-12 items-center justify-center rounded-full">
          <MessageSquare className="text-muted-foreground size-6" />
        </div>
        <p className="text-sm font-medium">{t("empty")}</p>
        <p className="text-muted-foreground text-xs">{t("emptyHint")}</p>
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
                now={now}
                locale={locale}
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
function ThreadRow({
  thread,
  selected,
  now,
  locale,
}: {
  thread: InboxThread;
  selected: boolean;
  now: number;
  locale: string;
}) {
  const t = useTranslations("messages");
  const tSafety = useTranslations("safety");
  const displayName = useMemberDisplayName();
  // Keyboard (focus-visible) focus on the row: the row's cover lifts and
  // names itself, as hovering it does.
  const [keyboardFocused, setKeyboardFocused] = useState(false);

  const unread = thread.unreadCount > 0;
  const { contextCopies } = thread;
  const last = thread.lastMessage;
  const isSystem = last?.kind === "system";
  // A removed message has an empty body: name the removal instead.
  const body = last?.removed
    ? tSafety("messageRemoved")
    : last?.body.replace(/\s+/g, " ").trim();
  const mine = last?.isMine === true;
  // A photo without a caption names the sender instead of an empty body.
  const photoOnly = last?.kind === "image" && !last.removed && !body;
  // A location always names the sharer (its caption is not the point).
  const location = last?.kind === "location" && !last.removed;
  const otherName = thread.subject.otherMember.anonymous
    ? t("anonymous")
    : displayName(thread.subject.otherMember.member);
  const snippet =
    body === undefined
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
  const fullTime = formatFullDateTime(thread.updatedAt, locale);
  // muted-foreground on the selected tint is < 4.5:1; darken it there.
  const mutedText = selected ? "text-foreground/75" : "text-muted-foreground";

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
      <ThreadSubjectAvatar subject={thread.subject} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-foreground min-w-0 flex-1 truncate text-sm leading-5",
              unread ? "font-bold" : "font-medium",
            )}
          >
            {threadSubjectTitle(thread.subject, t, displayName)}
          </span>
          <time
            dateTime={new Date(thread.updatedAt).toISOString()}
            title={fullTime}
            aria-hidden
            className={cn(
              "shrink-0 text-xs leading-5 tabular-nums",
              unread ? "text-primary-text font-semibold" : mutedText,
            )}
          >
            {formatCompactTime(thread.updatedAt, now, locale, t)}
          </time>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[13px] leading-5">
          {/* The most recent puzzle; the label summarises all of them. */}
          {contextCopies.length > 0 && (
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
                  thread.subject.otherMember,
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
              unread && !isSystem ? "text-foreground font-medium" : mutedText,
            )}
          >
            {snippet}
          </span>
          {unread && (
            <span
              aria-hidden
              className="bg-primary text-primary-foreground inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
            >
              {formatUnreadCount(thread.unreadCount)}
            </span>
          )}
        </div>
      </div>
      {/* The visual time and pill are aria-hidden; announce the full forms instead. */}
      {unread && (
        <span className="sr-only">
          {t("unreadCount", { count: thread.unreadCount })}
        </span>
      )}
      <span className="sr-only">{fullTime}</span>
    </Link>
  );
}

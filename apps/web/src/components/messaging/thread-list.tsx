"use client";

// Inbox pane of /messages: the reactive getMyInbox subscription rendered as
// open divided rows (the previous mock's ConversationRow styling, now on real
// data). PROVISIONAL layout per the design doc — all data access lives in the
// messaging components so a designer pass can restyle presentation only.

import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { gateway } from "@/gateway";
import { useDateFnsLocale } from "@/lib/date-locale";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeftRight, MessageSquare, User } from "lucide-react";
import { useTranslations } from "use-intl";
import {
  formatUnreadCount,
  threadSubjectTitle,
  type InboxThread,
} from "./format";

// Avatar chip for a thread subject: the member's avatar/initials for a
// revealed DM partner, a generic person glyph for an anonymised one, and an
// exchange icon chip for exchange threads.
export function ThreadSubjectAvatar({
  subject,
}: {
  subject: InboxThread["subject"];
}) {
  if (subject.kind === "dm" && !subject.otherMember.anonymous) {
    const name = subject.otherMember.member.name;
    return (
      <Avatar className="size-10 shrink-0">
        {subject.otherMember.member.avatar && (
          <AvatarImage src={subject.otherMember.member.avatar} alt={name} />
        )}
        <AvatarFallback>
          {name
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </AvatarFallback>
      </Avatar>
    );
  }
  const Icon = subject.kind === "exchange" ? ArrowLeftRight : User;
  return (
    <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
      <Icon className="size-[18px]" />
    </span>
  );
}

export function ThreadList({ activeThreadId }: { activeThreadId?: string }) {
  const t = useTranslations("messages");
  const { member } = useCurrentMember();
  const inbox = useQuery(
    gateway.conversation.getMyInbox,
    member?._id ? {} : "skip",
  );

  if (inbox === undefined) {
    return (
      <div className="space-y-3 py-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3 px-2">
            <div className="bg-muted size-10 shrink-0 animate-pulse rounded-full" />
            <div className="flex-1 space-y-2 py-1">
              <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
              <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (inbox.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <div className="bg-muted flex size-12 items-center justify-center rounded-full">
          <MessageSquare className="text-muted-foreground size-6" />
        </div>
        <p className="text-sm font-medium">{t("empty")}</p>
        <p className="text-muted-foreground text-xs">{t("emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {inbox.map((thread, index) => (
        <ThreadRow
          key={thread.threadId}
          thread={thread}
          selected={thread.threadId === activeThreadId}
          isLast={index === inbox.length - 1}
        />
      ))}
    </div>
  );
}

// One conversation as an open divided row: subject avatar, the title bolder
// when unread, the last-message preview (system messages stay muted), and a
// right column with the muted relative time over the unread-count pill.
function ThreadRow({
  thread,
  selected,
  isLast,
}: {
  thread: InboxThread;
  selected: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("messages");
  const dateLocale = useDateFnsLocale();

  const unread = thread.unreadCount > 0;
  // System messages render their body as-is, always muted.
  const isSystem = thread.lastMessage?.kind === "system";
  const preview = thread.lastMessage?.body ?? t("noMessages");

  return (
    <Link
      href={`/messages/${thread.threadId}`}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 px-2 py-3 text-left transition-colors",
        !isLast && "border-b",
        selected ? "bg-muted/60" : "hover:bg-muted/40",
      )}
    >
      <ThreadSubjectAvatar subject={thread.subject} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm",
            unread ? "font-bold" : "font-semibold",
          )}
        >
          {threadSubjectTitle(thread.subject, t)}
        </p>
        <p
          className={cn(
            "truncate text-sm",
            unread && !isSystem ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {preview}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 self-start pt-0.5">
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {formatDistanceToNow(new Date(thread.updatedAt), {
            addSuffix: true,
            locale: dateLocale,
          })}
        </span>
        {unread && (
          <>
            <span
              aria-hidden
              className="bg-primary text-primary-foreground inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
            >
              {formatUnreadCount(thread.unreadCount)}
            </span>
            {/* Announced as part of the link text, so the visual pill stays aria-hidden. */}
            <span className="sr-only">
              {t("unreadCount", { count: thread.unreadCount })}
            </span>
          </>
        )}
      </div>
    </Link>
  );
}

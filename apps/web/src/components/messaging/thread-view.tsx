"use client";

// Active-thread pane of /messages/$threadId: the getThreadMessages
// subscription (ascending), read receipts via markThreadRead, and the
// composer. Reuses the inbox subscription for the header subject — Convex
// dedupes it with the list pane. Messages render as author groups with day
// separators (message-center redesign spec §5–§6, §9).
//
// TODO: only the newest page (50 messages) renders — the getThreadMessages
// `before` cursor exists but a "load older messages" affordance is unbuilt.
import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { ChevronLeft, Info, MessageSquare } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { useLocale, useNow, useTranslations } from "use-intl";
import { MessageCopyCard } from "./copy-card";
import {
  formatFullDateTime,
  formatMessageTime,
  groupThreadMessages,
  threadSubjectTitle,
  type ThreadItem,
} from "./format";
import { MessageComposer } from "./message-composer";
import { ThreadSubjectAvatar } from "./thread-list";

type ThreadMessage = FunctionReturnType<
  typeof gateway.conversation.getThreadMessages
>[number];

// Live-region announcements quote at most this much of the message body.
const ANNOUNCE_MAX = 140;

export function ThreadView({
  threadId,
  // Task 11 (trades panel) embeds the view without the subject header/back
  // affordance; the standalone /messages route keeps the default.
  hideHeader = false,
}: {
  threadId: string;
  hideHeader?: boolean;
}) {
  const t = useTranslations("messages");
  const displayName = useMemberDisplayName();
  const locale = useLocale();
  // Day labels ("Today"/"Yesterday") roll over without a reload.
  const now = useNow({ updateInterval: 60_000 }).getTime();
  const { member } = useCurrentMember();
  const me = member?._id;

  const { data: messages } = useQuery({
    ...convexQuery(
      gateway.conversation.getThreadMessages,
      me ? { threadId } : "skip",
    ),
    // Stale/foreign thread ids must THROW so the $threadId route's
    // errorComponent renders AppNotFound (TanStack returns errors in .error
    // by default, which would leave the skeleton up forever).
    throwOnError: true,
  });
  const { data: inbox } = useQuery(
    convexQuery(gateway.conversation.getMyInbox, me ? {} : "skip"),
  );
  const thread = inbox?.find((row) => row.threadId === threadId);
  const title = thread
    ? threadSubjectTitle(thread.subject, t, displayName)
    : undefined;
  // Who wrote the other side's messages, for screen readers: the DM partner's
  // name (or the anonymous label); exchange titles name the puzzle, not a
  // person, so those use a generic label.
  const otherAuthor =
    thread?.subject.kind === "dm" && title ? title : t("otherMember");

  // mutateAsync is referentially stable, so the effect deps below behave as before.
  const { mutateAsync: markThreadRead } = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.markThreadRead),
  });
  const messageCount = messages?.length;
  const newestAuthorId = messages?.at(-1)?.authorId;
  // Changes when a pending send is confirmed (pending-… → real id) even though
  // the count doesn't: the confirmed group grows a time row, so follow again.
  const newestId = messages?.at(-1)?.id;

  // Per-thread one-shot flags, reset when navigating between threads.
  const hasMarkedReadRef = useRef(false);
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    hasMarkedReadRef.current = false;
    hasScrolledRef.current = false;
  }, [threadId]);

  useEffect(() => {
    // Mark read once the subscription has data — never while loading or
    // unauthenticated. After the initial receipt, skip changes whose newest
    // message is our own (optimistic) send: only others' messages (including
    // system messages, authorId null) create unread state.
    if (!me || messageCount === undefined) return;
    if (hasMarkedReadRef.current && newestAuthorId === me) return;
    hasMarkedReadRef.current = true;
    markThreadRead({ threadId }).catch(() => {
      // Non-fatal: the receipt catches up on the next message.
    });
  }, [me, messageCount, newestAuthorId, threadId, markThreadRead]);

  const scrollerRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Scroll rule: jump instantly to the newest message on first load; after
    // that, follow new messages only when the user is already near the bottom
    // or the newest message is their own send — never yank someone who
    // scrolled up to read history.
    const scroller = scrollerRef.current;
    if (!scroller || messageCount === undefined) return;
    if (!hasScrolledRef.current) {
      hasScrolledRef.current = true;
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    if (nearBottom || newestAuthorId === me) {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
  }, [messageCount, newestId, newestAuthorId, me]);

  // Thread switch: move focus to the header title so keyboard and screen-reader
  // users land in the new conversation (once per thread, after it renders).
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Phones hide the shell top bar (and its h1) on thread pages, so the thread
  // title is the page's h1 there; desktop keeps the shell's page h1.
  const Heading = useIsMobile() ? "h1" : "h2";
  const focusedThreadRef = useRef<string | null>(null);
  const headerReady = inbox !== undefined;
  useEffect(() => {
    if (hideHeader || !headerReady) return;
    if (focusedThreadRef.current === threadId) return;
    focusedThreadRef.current = threadId;
    headingRef.current?.focus({ preventScroll: true });
  }, [hideHeader, headerReady, threadId]);

  // Polite announcement for messages arriving from the other side — not on
  // first load, not for our own sends, not for system messages.
  // Written straight to the live-region node: it's a DOM side effect, and
  // React never renders children into that element.
  const liveRegionRef = useRef<HTMLDivElement>(null);
  const newest = messages?.at(-1);
  const lastSeenRef = useRef<
    { threadId: string; id: string | undefined } | undefined
  >(undefined);
  useEffect(() => {
    if (messages === undefined) return;
    const previous = lastSeenRef.current;
    lastSeenRef.current = { threadId, id: newest?.id };
    if (!previous || previous.threadId !== threadId) return;
    if (!newest || newest.id === previous.id) return;
    if (newest.authorId === null || newest.authorId === me) return;
    const text = newest.body.replace(/\s+/g, " ").trim();
    const region = liveRegionRef.current;
    if (!region) return;
    const announcement = t("newMessageAnnouncement", {
      name: title ?? t("threadFallbackTitle"),
      body:
        text.length > ANNOUNCE_MAX
          ? `${text.slice(0, ANNOUNCE_MAX - 1)}…`
          : text,
    });
    // Clear first and set on the next frame, so a message identical to the
    // previous announcement is still read out.
    region.textContent = "";
    const frame = requestAnimationFrame(() => {
      region.textContent = announcement;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, newest, threadId, me, title, t]);

  const items =
    messages === undefined
      ? undefined
      : groupThreadMessages(messages, me, now, locale, t);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!hideHeader && (
        <div className="bg-card sticky top-0 z-10 shrink-0 border-b pt-[env(safe-area-inset-top)] md:static md:pt-0">
          <div className="flex h-14 items-center gap-3 px-2 md:px-4">
            <BackToInboxLink />
            {inbox === undefined ? (
              <>
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-36" />
              </>
            ) : (
              <>
                {thread && (
                  <ThreadSubjectAvatar
                    subject={thread.subject}
                    className="size-9"
                  />
                )}
                {/* Inbox loaded but this thread isn't in it (e.g. a subject that
                    no longer resolves) — a generic title beats an eternal skeleton. */}
                <Heading
                  ref={headingRef}
                  tabIndex={-1}
                  className="font-heading decoration-primary-text/60 min-w-0 flex-1 truncate text-base font-bold underline-offset-4 outline-none focus-visible:underline"
                >
                  {title ?? t("threadFallbackTitle")}
                </Heading>
              </>
            )}
          </div>
        </div>
      )}

      {items === undefined ? (
        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 py-4 md:px-6"
          aria-hidden
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              className={cn(
                "h-9 rounded-2xl",
                i % 2 === 0 ? "w-[55%]" : "ml-auto w-[40%]",
              )}
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <div className="bg-muted flex size-12 items-center justify-center rounded-full">
            <MessageSquare className="text-muted-foreground size-6" />
          </div>
          <p className="text-sm font-medium">{t("noMessages")}</p>
          <p className="text-muted-foreground text-xs">{t("noMessagesHint")}</p>
        </div>
      ) : (
        <ol
          ref={scrollerRef}
          // Keyboard users can scroll the history without a mouse.
          tabIndex={0}
          aria-label={title ?? t("threadFallbackTitle")}
          className="focus-visible:ring-ring flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset md:px-6"
        >
          {items.map((item) => (
            <ThreadItemView
              key={item.key}
              item={item}
              locale={locale}
              otherAuthor={otherAuthor}
            />
          ))}
        </ol>
      )}

      <div
        ref={liveRegionRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      <MessageComposer threadId={threadId} recipientName={title} />
    </div>
  );
}

// Back to the inbox — mobile only (desktop keeps the list beside). The
// immersive thread routes hide the shell bars, so every state there needs it.
export function BackToInboxLink() {
  const t = useTranslations("messages");
  return (
    <Link
      href="/messages"
      aria-label={t("backToInbox")}
      className="hover:bg-accent focus-visible:ring-ring -ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 md:hidden"
    >
      <ChevronLeft className="size-5" />
    </Link>
  );
}

// One laid-out thread item: a day separator, a centered system line, or an
// author group of bubbles (copy cards sit beside — never inside — a bubble)
// with the group's time once under the last bubble.
function ThreadItemView({
  item,
  locale,
  otherAuthor,
}: {
  item: ThreadItem<ThreadMessage>;
  locale: string;
  otherAuthor: string;
}) {
  const t = useTranslations("messages");
  if (item.type === "day") {
    return (
      <li className="flex items-center gap-3 py-1">
        <span aria-hidden className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs font-semibold">
          {item.label}
        </span>
        <span aria-hidden className="bg-border h-px flex-1" />
      </li>
    );
  }
  if (item.type === "system") {
    return (
      <li className="text-muted-foreground mx-auto max-w-sm text-center text-xs">
        <Info className="mr-1 inline size-3.5 align-[-0.2em]" aria-hidden />
        {item.message.body}
      </li>
    );
  }

  const { own, messages } = item;
  const last = messages[messages.length - 1];
  const lastPending = last.id.startsWith("pending-");
  return (
    <li
      className={cn("flex flex-col gap-0.5", own ? "items-end" : "items-start")}
    >
      {/* Bubble side and colour carry authorship visually; say it too. */}
      <span className="sr-only">{own ? t("you") : otherAuthor}:</span>
      {messages.map((message, index) => {
        const pending = message.id.startsWith("pending-");
        return (
          <Fragment key={message.id}>
            {message.copy && (
              <MessageCopyCard
                copy={message.copy}
                className={cn("w-72 max-w-full", pending && "opacity-70")}
              />
            )}
            <div
              title={formatFullDateTime(message.sentAt, locale)}
              className={cn(
                "max-w-[min(80%,30rem)] rounded-2xl px-3.5 py-2 text-sm leading-5 break-words whitespace-pre-wrap",
                own
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
                bubbleCorners(own, index, messages.length),
                pending && "opacity-70",
              )}
            >
              {message.body}
            </div>
          </Fragment>
        );
      })}
      {!lastPending && (
        <time
          dateTime={new Date(last.sentAt).toISOString()}
          className="text-muted-foreground px-1 pt-0.5 text-[11px] tabular-nums"
        >
          {formatMessageTime(last.sentAt, locale)}
        </time>
      )}
    </li>
  );
}

// Tighten the inner-side corners where bubbles of one group stack.
function bubbleCorners(own: boolean, index: number, count: number) {
  if (count === 1) return undefined;
  const first = index === 0;
  const lastBubble = index === count - 1;
  if (own) {
    return first
      ? "rounded-br-md"
      : lastBubble
        ? "rounded-tr-md"
        : "rounded-r-md";
  }
  return first
    ? "rounded-bl-md"
    : lastBubble
      ? "rounded-tl-md"
      : "rounded-l-md";
}

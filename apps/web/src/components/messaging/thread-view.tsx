"use client";

// Active-thread pane of /messages/$threadId: the listThreadMessages
// paginated subscription (newest first, reversed to ascending for display;
// older pages load on scroll-up with the scroll position anchored), read
// receipts via markThreadRead once the newest messages are in view, and the
// composer. The header subject and the unread count behind the "New messages"
// divider come from the thread's own inbox row (getInboxThread), so a thread
// outside the list's loaded window still gets both.
// Messages render as author groups with day separators (message-center
// redesign spec §5–§6, §9).
import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { MemberInitial } from "@/components/members/member-initial";
import { PresenceDot } from "@/components/presence/presence-dot";
import { usePresenceOf } from "@/components/presence/use-presence";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, type Id } from "@/gateway";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { stripFormatting } from "@jigswap/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
// sanctioned convex/react exception: usePaginatedQuery (see tanstack-query migration spec)
import { usePaginatedQuery, type PaginatedQueryItem } from "convex/react";
import {
  ArrowDown,
  ChevronLeft,
  EyeOff,
  Info,
  MessageSquare,
  Puzzle as PuzzleIcon,
  UserRound,
} from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useLocale, useNow, useTranslations } from "use-intl";
import { CircleThreadHeader } from "./circle-thread-header";
import { ComposerClosed } from "./composer-closed";
import { MessageCopyCard } from "./copy-card";
import {
  anonymousLabel,
  countOthersAfter,
  firstUnreadId,
  formatFullDateTime,
  formatMessageTime,
  groupThreadMessages,
  isCircleThread,
  memberProfileHref,
  newestOtherId,
  newestSentId,
  projectedMemberLabel,
  segmentMessages,
  systemEventText,
  threadSubjectTitle,
  tradeEventText,
  unreadRunLoaded,
  type InboxThread,
  type ThreadItem,
} from "./format";
import { NO_SPLIT_ONLY_CLASS } from "./frame";
import { MessageActions } from "./message-actions";
import { MessageComposer } from "./message-composer";
import { locationAttachmentOf, MessageLocation } from "./message-location";
import { MessagePhotos } from "./message-photos";
import { MessageText } from "./message-text";
import { OlderMessagesSlot } from "./older-messages-slot";
import { PhotoOutbox } from "./photo-outbox";
import { RemovedMessage } from "./removed-message";
import { ReplyRevealHint } from "./reply-reveal-hint";
import { ThreadSubjectAvatar } from "./thread-list";
import { threadPartner } from "./thread-partner";
import { ThreadPuzzleStack } from "./thread-puzzle-stack";
import { ThreadQuickLinks } from "./thread-quick-links";
import {
  anchoredScrollTop,
  isNearBottom,
  type ScrollSnapshot,
} from "./thread-scroll";
import { TypingLine } from "./typing-line";

type ThreadMessage = PaginatedQueryItem<
  typeof gateway.conversation.listThreadMessages
>;

// Messages per page: the first page and each older page loaded on scroll-up.
const PAGE_SIZE = 20;

// Live-region announcements quote at most this much of the message body.
const ANNOUNCE_MAX = 140;

// A thread with unread messages opens with the "New messages" divider this far
// below the top of the list, so a little of what was already read shows above.
const UNREAD_DIVIDER_GAP = 16;

// The thread title takes focus when a thread opens (keyboard and screen-reader
// users land in it), so :focus-visible matches on load. A tinted background
// marks that focus; an underline made the plain name look like a profile
// link (UX-177). -mx-1/px-1 pad the tint without moving the text; w-fit keeps
// it to the name, and the max width (the column plus that 0.5rem of bleed)
// keeps a long name truncating instead of overflowing.
const HEADING_FOCUS_CLASS =
  "font-heading -mx-1 w-fit max-w-[calc(100%+0.5rem)] min-w-0 truncate rounded-sm px-1 text-base font-bold outline-none focus-visible:bg-accent";

export function ThreadView({
  threadId,
  // Task 11 (trades panel) embeds the view without the subject header/back
  // affordance; the standalone /messages route keeps the default.
  hideHeader = false,
  attachCopyId,
}: {
  threadId: string;
  hideHeader?: boolean;
  // The puzzle to stage on the composer (the route's ?attach, a copy's "Message").
  attachCopyId?: string;
}) {
  const t = useTranslations("messages");
  const tPresence = useTranslations("presence");
  const displayName = useMemberDisplayName();
  const locale = useLocale();
  // Day labels ("Today"/"Yesterday") roll over without a reload.
  const now = useNow({ updateInterval: 60_000 }).getTime();
  const { member } = useCurrentMember();
  const me = member?._id;

  // Convex's reactive pagination, newest first: the first page grows as new
  // messages arrive, older pages keep stable boundaries. Errors (stale or
  // foreign thread ids) throw during render, so the $threadId route's
  // errorComponent renders AppNotFound.
  const {
    results: newestFirst,
    status,
    loadMore,
  } = usePaginatedQuery(
    gateway.conversation.listThreadMessages,
    me ? { threadId } : "skip",
    { initialNumItems: PAGE_SIZE },
  );
  // Ascending for rendering; undefined while the first page loads.
  const messages = useMemo(
    () =>
      status === "LoadingFirstPage" ? undefined : [...newestFirst].reverse(),
    [newestFirst, status],
  );
  // This thread's inbox row: undefined while loading, null when the inbox
  // wouldn't list it (e.g. a subject that no longer resolves) or couldn't be
  // read at all.
  const { data: inboxRow, isError: inboxRowFailed } = useQuery(
    convexQuery(
      gateway.conversation.getInboxThread,
      me ? { threadId } : "skip",
    ),
  );
  // A backend without getInboxThread (the web can deploy before it): find the
  // row in the inbox's first page instead, as before.
  const { data: inboxPage, isError: inboxPageFailed } = useQuery(
    convexQuery(
      gateway.conversation.getMyInbox,
      me && inboxRowFailed ? {} : "skip",
    ),
  );
  const headerRow = inboxRowFailed
    ? inboxPage === undefined
      ? inboxPageFailed
        ? null
        : undefined
      : (inboxPage.find((row) => row.threadId === threadId) ?? null)
    : inboxRow;
  // My photos here that aren't messages yet (being checked, or stopped).
  const { data: pendingPhotos } = useQuery(
    convexQuery(
      gateway.conversation.listMyPendingAttachments,
      me ? { threadId } : "skip",
    ),
  );
  const outboxCount =
    pendingPhotos?.filter((photo) => photo.sendRequested).length ?? 0;
  const thread = headerRow ?? undefined;
  // A circle (group) thread, or the two-party (DM / exchange) thread.
  const circleThread = thread && isCircleThread(thread) ? thread : undefined;
  const pairThread =
    thread && !circleThread ? (thread as InboxThread) : undefined;
  const title = thread
    ? threadSubjectTitle(thread.subject, t, displayName)
    : undefined;
  // Several open threads can be told apart. An embedded thread leaves its page's title alone.
  const tTitles = useTranslations("titles");
  useDocumentTitle(
    title && !hideHeader ? tTitles("threadOf", { name: title }) : undefined,
  );
  // Who wrote the other side's messages, for screen readers: the DM or trading
  // partner's display name, the anonymous label when they're anonymised, and a
  // generic label until the inbox row has loaded. Circle threads name each
  // message's own author instead.
  const otherMember = pairThread?.subject.otherMember;
  const otherAuthor = !otherMember
    ? t("otherMember")
    : otherMember.anonymous
      ? anonymousLabel(otherMember, t)
      : displayName(otherMember.member);
  // The other side's author, for their messages' Report: absent when anonymised.
  const otherAuthorId = pairThread ? threadPartner(pairThread)?._id : undefined;
  // The partner's presence, DM or exchange alike: the backend returns a status only when the
  // viewer may see it (mutual followers who both share), so non-mutual trade partners show none.
  // Only the header shows it, so a header-less embed doesn't subscribe.
  const presenceTarget = hideHeader ? undefined : otherAuthorId;
  const partnerPresence = usePresenceOf([presenceTarget]).get(
    presenceTarget ?? "",
  );
  // The attach picker's "their puzzles" tab, named for the DM or trading
  // partner; absent for an anonymised member (the backend lists none of their
  // copies).
  const theirsLabel =
    !otherMember || otherMember.anonymous
      ? null
      : t("tabTheirs", { name: displayName(otherMember.member) });

  // mutateAsync is referentially stable, so the effect deps below behave as before.
  const { mutateAsync: markThreadRead } = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.markThreadRead),
  });
  const newestIsMine = messages?.at(-1)?.isMine;
  // Changes when a message arrives at the bottom and when a pending send is
  // confirmed (pending-… → real id: the confirmed group grows a time row, so
  // follow again) — but not when an older page is prepended, so the
  // follow-scroll below doesn't fire on scroll-up loads.
  const newestId = messages?.at(-1)?.id;
  const oldestId = messages?.[0]?.id;
  // The newest message the reader didn't write: what a read receipt covers.
  // Own sends don't move it, so they never send one.
  const latestOtherId = messages && newestOtherId(messages);
  const latestSentId = messages && newestSentId(messages);

  // The unread boundary (UX-115): the inbox row's unread count as the thread
  // opens — taken once per thread, before this view's first read receipt
  // clears it — and the newest of others' messages at that moment, where that
  // unread run ends. Set during render, guarded to once per thread, so the
  // first paint already has the divider. An inbox that failed to load only
  // costs the divider: the messages still lay out.
  const [unread, setUnread] = useState<{
    threadId: string;
    count: number;
    upToId: string | undefined;
    // Whether the messages reach back to the start of that run, or no older
    // page is coming. Until then the thread holds its layout (see below).
    // Latched: a page that briefly drops out of the paginated results never
    // takes a laid-out thread back to its skeleton.
    runLoaded: boolean;
  }>();
  // Where the reader is, per thread, as of their last scroll: at the bottom or
  // not, and the newest message they had in view there. Others' messages after
  // it, arriving while they read history, count in the "N new messages" pill
  // (UX-115); the unread run below the divider on open doesn't.
  const [position, setPosition] = useState<{
    threadId: string;
    atBottom: boolean;
    seenId: string | undefined;
  }>();
  // More unread than the first page holds (UX-115): until the run's first
  // message is loaded, the divider would sit on the oldest loaded message, and
  // the page the scroll-up sentinel loads right after the first-load scroll
  // would move it up, out of view. So the thread loads older pages before it
  // lays out. The inbox caps the count at 50, so that's a few pages at most.
  const olderPagesComing = status === "CanLoadMore" || status === "LoadingMore";
  if (
    messages !== undefined &&
    headerRow !== undefined &&
    unread?.threadId !== threadId
  ) {
    const count = thread?.unreadCount ?? 0;
    const upToId = newestOtherId(messages);
    setUnread({
      threadId,
      count,
      upToId,
      runLoaded: !olderPagesComing || unreadRunLoaded(messages, count, upToId),
    });
    setPosition({ threadId, atBottom: true, seenId: newestSentId(messages) });
  } else if (
    messages !== undefined &&
    unread?.threadId === threadId &&
    !unread.runLoaded &&
    (!olderPagesComing ||
      unreadRunLoaded(messages, unread.count, unread.upToId))
  ) {
    setUnread({ ...unread, runLoaded: true });
  }
  const loadingUnreadRun = unread?.threadId === threadId && !unread.runLoaded;
  useEffect(() => {
    if (loadingUnreadRun && status === "CanLoadMore") loadMore(PAGE_SIZE);
  }, [loadingUnreadRun, status, loadMore]);
  // The messages, their unread snapshot and the whole unread run are in: the
  // thread lays out.
  const ready =
    messages !== undefined && unread?.threadId === threadId && unread.runLoaded;

  // Per-thread one-shot flag, reset when navigating between threads.
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    hasScrolledRef.current = false;
  }, [threadId]);

  // The last read receipt sent: which thread, up to which message.
  const receiptRef = useRef<Receipt | undefined>(undefined);

  const scrollerRef = useRef<HTMLOListElement>(null);
  const dividerRef = useRef<HTMLLIElement>(null);
  // Scroll anchoring for prepended older pages: the scroller as it was before
  // the latest commit (refreshed on scroll and after every commit). When the
  // oldest rendered message changed because a page was prepended, restore the
  // position so the content the reader was looking at stays put. A layout
  // effect, so the corrected position is what gets painted.
  const scrollSnapshotRef = useRef<ScrollSnapshot | undefined>(undefined);
  // Whether the newest message is in view: as of the reader's last scroll, or
  // because the first-load jump or a followed arrival put it there. A photo
  // that finishes loading then keeps the newest message in view, and the read
  // receipt waits for it.
  const pinnedRef = useRef(true);
  const recordScroll = () => {
    const scroller = scrollerRef.current;
    scrollSnapshotRef.current = scroller
      ? {
          oldestId,
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
        }
      : undefined;
  };
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (
      scroller &&
      messages &&
      oldestId !== scrollSnapshotRef.current?.oldestId
    ) {
      const top = anchoredScrollTop(
        scrollSnapshotRef.current,
        messages,
        scroller.scrollHeight,
      );
      if (top !== undefined) scroller.scrollTop = top;
    }
    recordScroll();
  });

  const onListScroll = () => {
    recordScroll();
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const atBottom = isNearBottom(scroller);
    pinnedRef.current = atBottom;
    setPosition((previous) => {
      if (previous?.threadId !== threadId) return previous;
      // At the bottom, or just leaving it: everything up to the newest message
      // has been in view.
      const seenId =
        atBottom || previous.atBottom ? latestSentId : previous.seenId;
      return previous.atBottom === atBottom && previous.seenId === seenId
        ? previous
        : { threadId, atBottom, seenId };
    });
    // Scrolling down to the newest messages reads them (UX-115).
    if (
      me &&
      pinnedRef.current &&
      claimReceipt(receiptRef, threadId, latestOtherId)
    ) {
      markThreadRead({ threadId }).catch(() => {
        // Non-fatal: the receipt catches up on the next message.
      });
    }
  };

  // The pill's jump: down to the newest message, where onListScroll clears the
  // pill and sends the read receipt. Focus moves to the list first, since the
  // pill goes away under it.
  const jumpToNewest = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.focus({ preventScroll: true });
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  // Stable (it only reads refs), so the memoized bubbles don't re-render for it.
  const onMediaLoad = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller && pinnedRef.current) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, []);

  useEffect(() => {
    // Scroll rule. On first load, open at the "New messages" divider when
    // there is one (a little above it; the browser clamps, so a short unread
    // run still ends at the bottom), else jump to the newest message. After
    // that, follow new messages only when the reader was at the bottom or the
    // newest message is their own send — never yank someone who scrolled up to
    // read history. Either way, record whether the newest message is now in
    // view: the read receipt below waits for it.
    if (!ready) return;
    const scroller = scrollerRef.current;
    if (!scroller) {
      // An empty thread: nothing to scroll, nothing out of view.
      pinnedRef.current = true;
      return;
    }
    if (!hasScrolledRef.current) {
      hasScrolledRef.current = true;
      const divider = dividerRef.current;
      scroller.scrollTop = divider
        ? scroller.scrollTop +
          divider.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          UNREAD_DIVIDER_GAP
        : scroller.scrollHeight;
      pinnedRef.current = isNearBottom(scroller);
      return;
    }
    // pinnedRef is still where the reader was before this message arrived; a
    // tall one can land beyond the near-bottom band.
    if (pinnedRef.current || isNearBottom(scroller) || newestIsMine) {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: reduceMotion ? "auto" : "smooth",
      });
      pinnedRef.current = true;
    }
  }, [ready, newestId, newestIsMine, outboxCount]);

  useEffect(() => {
    // Read receipt (UX-115): only once the unread snapshot is taken (so the
    // divider is placed before the inbox count clears), and only with the
    // newest message in view — on open, and for each followed arrival from
    // others. While the reader is scrolled up it waits; onListScroll sends it
    // when they reach the bottom. Declared after the scroll rule, which
    // decides what's in view.
    if (!me || !ready || !pinnedRef.current) return;
    if (!claimReceipt(receiptRef, threadId, latestOtherId)) return;
    markThreadRead({ threadId }).catch(() => {
      // Non-fatal: the receipt catches up on the next message.
    });
  }, [me, ready, threadId, latestOtherId, markThreadRead]);

  // Infinite scroll-up: load the next older page when the sentinel at the top
  // of the list comes into view (within 200px). Declared after the first-load
  // jump above so the initial observation sees the list already scrolled into
  // place; re-observing on each status change keeps loading while a short
  // thread still leaves the sentinel visible.
  const sentinelRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !ready || status !== "CanLoadMore") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore(PAGE_SIZE);
        }
      },
      { root: scrollerRef.current, rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [ready, status, loadMore]);

  // A keyboard user who pressed "Load earlier messages" keeps focus on it
  // while the page loads; when that was the last page the button gives way to
  // the start-of-conversation marker, so hand focus to the history list.
  const loadRequestedByButtonRef = useRef(false);
  useLayoutEffect(() => {
    if (status === "LoadingMore" || !loadRequestedByButtonRef.current) return;
    loadRequestedByButtonRef.current = false;
    if (status === "Exhausted" && document.activeElement === document.body) {
      scrollerRef.current?.focus({ preventScroll: true });
    }
  }, [status]);

  // Thread switch: move focus to the header title so keyboard and screen-reader
  // users land in the new conversation (once per thread, after it renders).
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The thread title is an h2 at every width: the shell's page h1 ("Messages") is the
  // page head's title from md and its sr-only phone heading below md.
  const focusedThreadRef = useRef<string | null>(null);
  const headerReady = headerRow !== undefined;
  // Opened to write about a puzzle: from md up the composer takes focus instead, as it does in a
  // first conversation about a copy. Phones wait for a tap, so the keyboard stays down.
  const isMobile = useIsMobile();
  const composerTakesFocus = attachCopyId !== undefined && !isMobile;
  useEffect(() => {
    if (hideHeader || !headerReady) return;
    if (focusedThreadRef.current === threadId) return;
    focusedThreadRef.current = threadId;
    if (composerTakesFocus) return;
    headingRef.current?.focus({ preventScroll: true });
  }, [hideHeader, headerReady, threadId, composerTakesFocus]);

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
    if (newest.kind === "system" || newest.isMine) return;
    // A member the viewer blocked stays collapsed, so it isn't read out either.
    if (newest.authorBlockedByMe) return;
    const text = stripFormatting(newest.body).replace(/\s+/g, " ").trim();
    const region = liveRegionRef.current;
    if (!region) return;
    const body =
      text.length > ANNOUNCE_MAX ? `${text.slice(0, ANNOUNCE_MAX - 1)}…` : text;
    // In a circle thread the author is named per message: "Bas in Puzzle Club: …".
    const circleName = circleThread ? title : undefined;
    const name =
      circleName !== undefined
        ? newest.author
          ? projectedMemberLabel(newest.author, t, displayName)
          : t("otherMember")
        : (title ?? t("threadFallbackTitle"));
    const announcement =
      newest.kind === "image" && !text
        ? t("photos.sentAPhoto", { name })
        : newest.kind === "location"
          ? t("locations.sharedALocation", { name })
          : circleName !== undefined
            ? t("circle.announcement", {
                author: name,
                circle: circleName,
                body,
              })
            : t("newMessageAnnouncement", { name, body });
    // Clear first and set on the next frame, so a message identical to the
    // previous announcement is still read out.
    region.textContent = "";
    const frame = requestAnimationFrame(() => {
      region.textContent = announcement;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, newest, threadId, title, circleThread, displayName, t]);

  // Day labels only depend on which local day it is, so the items (and the memoized bubbles they
  // feed) are rebuilt when the messages, the day or the language change, not on every minute
  // tick, inbox update or presence change. `unread` is a snapshot taken once per thread, so none
  // of those change it either.
  const nowDate = new Date(now);
  const today = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
  ).getTime();
  const items = useMemo(
    () =>
      messages === undefined ||
      unread?.threadId !== threadId ||
      !unread.runLoaded
        ? undefined
        : groupThreadMessages(
            messages,
            today,
            locale,
            t,
            firstUnreadId(messages, unread.count, unread.upToId),
          ),
    [messages, unread, threadId, today, locale, t],
  );
  const newCount =
    messages !== undefined &&
    position?.threadId === threadId &&
    !position.atBottom
      ? countOthersAfter(messages, position.seenId)
      : 0;

  return (
    // ph-no-capture: PostHog never autocaptures or records private messages.
    // From md the thread pane is the `thread` container the header's quick
    // links query, so they shrink to icons when the pane is narrow (UX-02).
    <div className="ph-no-capture flex min-h-0 flex-1 flex-col md:@container/thread">
      {!hideHeader && (
        <div className="bg-card sticky top-0 z-10 shrink-0 border-b pt-[env(safe-area-inset-top)] md:static md:pt-0">
          <div className="flex h-14 items-center gap-3 px-2 md:px-4">
            <BackToInboxLink />
            {headerRow === undefined ? (
              <>
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-36" />
              </>
            ) : circleThread ? (
              <CircleThreadHeader
                thread={circleThread}
                heading={
                  <h2
                    ref={headingRef}
                    tabIndex={-1}
                    className={cn(HEADING_FOCUS_CLASS, "leading-5")}
                  >
                    {title}
                    <span className="sr-only">, {t("circle.circleChat")}</span>
                  </h2>
                }
              />
            ) : (
              <>
                {pairThread && (
                  // The status line below names the status for screen readers.
                  <span aria-hidden className="relative flex shrink-0">
                    <ThreadSubjectAvatar
                      subject={pairThread.subject}
                      className="size-9"
                    />
                    <PresenceDot status={partnerPresence} />
                  </span>
                )}
                <div className="flex min-w-0 flex-col">
                  {/* Loaded, but the inbox wouldn't list this thread (e.g. a subject
                      that no longer resolves) — a generic title beats an eternal skeleton. */}
                  <h2
                    ref={headingRef}
                    tabIndex={-1}
                    className={HEADING_FOCUS_CLASS}
                  >
                    {title ?? t("threadFallbackTitle")}
                  </h2>
                  {partnerPresence && (
                    <p className="text-muted-foreground text-xs leading-4">
                      {tPresence(partnerPresence)}
                    </p>
                  )}
                </div>
                {/* The conversation's puzzles, right beside the name. */}
                {pairThread && <ThreadPuzzleStack thread={pairThread} />}
                <div className="ml-auto flex shrink-0 items-center">
                  {pairThread && (
                    <ThreadQuickLinks
                      thread={pairThread}
                      compact={
                        pairThread.subject.kind === "exchange" &&
                        pairThread.subject.profileHandle !== null &&
                        pairThread.contextCopies.length > 0
                      }
                    />
                  )}
                </div>
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
      ) : items.length === 0 && outboxCount === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <div className="bg-muted flex size-12 items-center justify-center rounded-full">
            <MessageSquare className="text-muted-foreground size-6" />
          </div>
          <p className="text-sm font-medium">{t("noMessages")}</p>
          <p className="text-muted-foreground text-xs">{t("noMessagesHint")}</p>
        </div>
      ) : (
        // The pill floats over the bottom of the list, above the composer.
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ol
            ref={scrollerRef}
            // Keyboard users can scroll the history without a mouse.
            tabIndex={0}
            aria-label={title ?? t("threadFallbackTitle")}
            onScroll={onListScroll}
            className="focus-visible:ring-ring flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset md:px-6"
          >
            <OlderMessagesSlot
              status={status}
              sentinelRef={sentinelRef}
              onLoadMore={() => {
                loadRequestedByButtonRef.current = true;
                loadMore(PAGE_SIZE);
              }}
            />
            {items.map((item) =>
              item.type === "unread" ? (
                <UnreadDivider key={item.key} ref={dividerRef} />
              ) : (
                <ThreadItemView
                  key={item.key}
                  item={item}
                  locale={locale}
                  otherAuthor={otherAuthor}
                  otherAuthorId={otherAuthorId as Id<"users"> | undefined}
                  circle={circleThread !== undefined}
                  meId={me}
                  onMediaLoad={onMediaLoad}
                />
              ),
            )}
            {pendingPhotos && (
              <PhotoOutbox pending={pendingPhotos} onMediaLoad={onMediaLoad} />
            )}
          </ol>
          {newCount > 0 && (
            <button
              type="button"
              onClick={jumpToNewest}
              className="bg-primary text-primary-foreground focus-visible:ring-ring absolute bottom-3 left-1/2 z-10 inline-flex h-11 -translate-x-1/2 items-center gap-1.5 rounded-full px-4 text-sm font-medium whitespace-nowrap shadow-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2 md:h-9 md:px-3.5 pointer-coarse:min-h-11"
            >
              <ArrowDown aria-hidden className="size-4" />
              {t("newMessagesPill", { count: newCount })}
            </button>
          )}
        </div>
      )}

      <div
        ref={liveRegionRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {/* A blocked (byMe) or read-only thread stays readable; only the composer closes. */}
      {thread && (thread.blocked === "byMe" || thread.readOnly) ? (
        <ComposerClosed
          reason={thread.blocked === "byMe" ? "blockedByMe" : "cantReply"}
          partner={pairThread ? threadPartner(pairThread) : null}
        />
      ) : (
        <>
          <TypingLine threadId={threadId} />
          {pairThread?.subject.kind === "exchange" && (
            <ReplyRevealHint
              exchangeId={pairThread.subject.exchangeId}
              partnerName={otherAuthor}
            />
          )}
          <MessageComposer
            threadId={threadId}
            attachCopyId={attachCopyId}
            // A circle is never addressed like a person: it gets its own label.
            recipientName={circleThread ? undefined : title}
            theirsLabel={theirsLabel}
            {...(circleThread && {
              label: t("circle.composerLabel", {
                circle: circleThread.subject.name,
              }),
              placeholder: t("circle.composerPlaceholder", {
                circle: circleThread.subject.name,
              }),
              attachHint: t("circle.attachHint", {
                circle: circleThread.subject.name,
              }),
              locationGroup: {
                circle: circleThread.subject.name,
                // Everyone but the sender sees the spot.
                others: Math.max(1, circleThread.subject.memberCount - 1),
              },
            })}
          />
        </>
      )}
    </div>
  );
}

// Back to the inbox whenever the list isn't beside the thread: on phones (the
// immersive thread routes hide the shell bars, so every state there needs it)
// and wherever the messages frame is too narrow to split (frame.ts).
export function BackToInboxLink() {
  const t = useTranslations("messages");
  return (
    <Link
      href="/messages"
      aria-label={t("backToInbox")}
      className={cn(
        "hover:bg-accent focus-visible:ring-ring -ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2",
        NO_SPLIT_ONLY_CLASS,
      )}
    >
      <ChevronLeft className="size-5" />
    </Link>
  );
}

// The last read receipt a thread view sent: which thread, up to which message
// (the newest one the reader didn't write).
type Receipt = { threadId: string; upToId: string | undefined };

// Claims the read receipt for `threadId` up to `upToId` when one is due: once
// when the thread opens, then once per new message from others — never again
// for the same messages, and never for the reader's own sends.
function claimReceipt(
  last: RefObject<Receipt | undefined>,
  threadId: string,
  upToId: string | undefined,
): boolean {
  const sent = last.current;
  if (sent?.threadId === threadId && sent.upToId === upToId) return false;
  last.current = { threadId, upToId };
  return true;
}

// Where the messages that were unread when the thread opened begin (UX-115).
function UnreadDivider({ ref }: { ref: Ref<HTMLLIElement> }) {
  const t = useTranslations("messages");
  return (
    <li ref={ref} className="flex items-center gap-3 py-1">
      <span aria-hidden className="bg-primary-text/40 h-px flex-1" />
      <span className="text-primary-text text-xs font-semibold">
        {t("unreadDivider")}
      </span>
      <span aria-hidden className="bg-primary-text/40 h-px flex-1" />
    </li>
  );
}

// One laid-out thread item: a day separator, a centered system line, or an
// author group of bubbles (copy cards sit beside — never inside — a bubble)
// with the group's time once under the last bubble. In a circle thread a run
// of others' messages is headed by its author (avatar + name), and a run from
// a member the viewer blocked is collapsed until they choose Show. Memoized: the
// thread view re-renders on minute ticks, inbox and presence updates, which
// leave every item's props unchanged.
const ThreadItemView = memo(function ThreadItemView({
  item,
  locale,
  otherAuthor,
  otherAuthorId,
  circle,
  meId,
  onMediaLoad,
}: {
  item: Exclude<ThreadItem<ThreadMessage>, { type: "unread" }>;
  locale: string;
  otherAuthor: string;
  otherAuthorId: Id<"users"> | undefined;
  circle: boolean;
  meId: string | undefined;
  onMediaLoad: () => void;
}) {
  const t = useTranslations("messages");
  const displayName = useMemberDisplayName();
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
        {item.message.systemEvent
          ? systemEventText(item.message.systemEvent, meId, t, displayName)
          : item.message.tradeEvent
            ? tradeEventText(item.message.tradeEvent, t)
            : item.message.body}
      </li>
    );
  }

  const { own, messages } = item;
  // A circle thread names each run's author; a DM or exchange has one other side.
  const runAuthor = circle && !own ? messages[0].author : undefined;
  if (circle && !own) {
    const name = runAuthor
      ? projectedMemberLabel(runAuthor, t, displayName)
      : t("otherMember");
    const id =
      runAuthor && !runAuthor.anonymous
        ? (runAuthor.member._id as Id<"users">)
        : undefined;
    return (
      <CircleRun
        item={item}
        author={runAuthor}
        authorName={name}
        blocked={messages[0].authorBlockedByMe === true}
      >
        {(hideMedia) => (
          <GroupBody
            item={item}
            locale={locale}
            authorName={name}
            authorId={id}
            hideMedia={hideMedia}
            onMediaLoad={onMediaLoad}
            // Another member's puzzle may be visible to only some of the circle.
            copyUnavailableLabel={t("circle.copyUnavailable")}
          />
        )}
      </CircleRun>
    );
  }
  return (
    <li
      className={cn("flex flex-col gap-0.5", own ? "items-end" : "items-start")}
    >
      {/* Bubble side and colour carry authorship visually; say it too. */}
      <span className="sr-only">{own ? t("you") : otherAuthor}:</span>
      <GroupBody
        item={item}
        locale={locale}
        authorName={otherAuthor}
        authorId={otherAuthorId}
        hideMedia={false}
        onMediaLoad={onMediaLoad}
      />
    </li>
  );
});

type GroupItem = Extract<ThreadItem<ThreadMessage>, { type: "group" }>;

// A circle run of another member's messages: their 24px avatar and name above
// the first bubble (a profile link unless anonymised; the tap target grows to
// 44px on phones), then the bubbles. A run from a member the viewer blocked
// shows one collapsed placeholder; Show reveals the text, while photos and
// locations stay collapsed.
function CircleRun({
  item,
  author,
  authorName,
  blocked,
  children,
}: {
  item: GroupItem;
  author: ThreadMessage["author"];
  authorName: string;
  blocked: boolean;
  children: (hideMedia: boolean) => ReactNode;
}) {
  const t = useTranslations("messages");
  const [revealed, setRevealed] = useState(false);
  const href = author ? memberProfileHref(author) : null;
  const avatar = (
    <Avatar aria-hidden className="size-6">
      {author && !author.anonymous && author.member.avatar && (
        <AvatarImage src={author.member.avatar} alt="" />
      )}
      <AvatarFallback className="text-[10px]">
        {author && !author.anonymous ? (
          <MemberInitial source={author.member} />
        ) : (
          <UserRound className="size-[55%]" aria-hidden />
        )}
      </AvatarFallback>
    </Avatar>
  );
  const label = (
    <>
      {avatar}
      <span className="text-muted-foreground truncate text-xs font-semibold">
        {authorName}
      </span>
    </>
  );
  return (
    <li className="flex flex-col items-start gap-0.5">
      {href ? (
        <Link
          href={href}
          className="focus-visible:ring-ring relative flex h-8 max-w-full items-center gap-2 rounded-full pr-2 outline-none hover:underline focus-visible:ring-2 max-md:before:absolute max-md:before:inset-x-0 max-md:before:-inset-y-1.5"
        >
          {label}
        </Link>
      ) : (
        <span className="flex h-8 max-w-full items-center gap-2 pr-2">
          {label}
        </span>
      )}
      {/* The name above already says who wrote it; screen readers hear it there. */}
      <div className="flex w-full flex-col items-start gap-0.5 pl-8">
        {blocked && !revealed ? (
          <div className="bg-muted/60 text-muted-foreground flex max-w-[min(80%,30rem)] items-center gap-2 rounded-2xl border border-dashed px-3.5 py-2 text-sm">
            <EyeOff aria-hidden className="size-4 shrink-0" />
            <span>{t("circle.blocked", { count: item.messages.length })}</span>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="text-foreground focus-visible:ring-ring relative rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-2 max-md:before:absolute max-md:before:-inset-x-2 max-md:before:-inset-y-3"
            >
              {t("circle.show")}
            </button>
          </div>
        ) : (
          children(blocked)
        )}
      </div>
    </li>
  );
}

// An author group's bubbles, cards and media, with the group's time under the
// last bubble. `hideMedia` keeps photos and locations collapsed (a blocked
// member's run after Show).
function GroupBody({
  item,
  locale,
  authorName,
  authorId,
  hideMedia,
  onMediaLoad,
  copyUnavailableLabel,
}: {
  item: GroupItem;
  locale: string;
  authorName: string;
  authorId: Id<"users"> | undefined;
  hideMedia: boolean;
  onMediaLoad: () => void;
  /** The unavailable-puzzle placeholder's text, when not the default. */
  copyUnavailableLabel?: string;
}) {
  const t = useTranslations("messages");
  const otherAuthor = authorName;
  const otherAuthorId = authorId;
  const { own, messages } = item;
  const last = messages[messages.length - 1];
  const lastPending = last.id.startsWith("pending-");
  const renderMessage = (message: ThreadMessage, index: number) => {
    const pending = message.id.startsWith("pending-");
    const bubble = (
      <div
        title={formatFullDateTime(message.sentAt, locale)}
        className={cn(
          BUBBLE_CLASS,
          own
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
          bubbleCorners(own, index, messages.length),
          pending && "opacity-70",
        )}
      >
        <MessageText body={message.body} />
      </div>
    );
    if (message.kind === "location" && !message.removed) {
      // The map card carries the message's More menu (Report, Copy text of
      // the caption); the caption bubble follows below.
      const media = hideMedia ? (
        <CollapsedMedia label={t("circle.blockedLocation")} />
      ) : (
        <MessageLocation
          location={locationAttachmentOf(message.attachment)}
          className={cn(pending && "opacity-70")}
          onMediaLoad={onMediaLoad}
        />
      );
      return (
        <Fragment key={message.id}>
          {own ? (
            media
          ) : (
            <MessageActions
              messageId={message.id}
              body={message.body}
              authorName={otherAuthor}
              authorId={otherAuthorId}
            >
              {media}
            </MessageActions>
          )}
          {message.body.trim() && bubble}
        </Fragment>
      );
    }
    return (
      <Fragment key={message.id}>
        {message.copy && (
          <MessageCopyCard
            copy={message.copy}
            className={cn("w-72 max-w-full", pending && "opacity-70")}
          />
        )}
        {message.copyUnavailable && (
          <CopyUnavailableCard
            label={copyUnavailableLabel}
            className={cn(pending && "opacity-70")}
          />
        )}
        {message.removed ? (
          <RemovedMessage
            title={formatFullDateTime(message.sentAt, locale)}
            className={bubbleCorners(own, index, messages.length)}
          />
        ) : own ? (
          bubble
        ) : (
          <MessageActions
            messageId={message.id}
            body={message.body}
            authorName={otherAuthor}
            authorId={otherAuthorId}
          >
            {bubble}
          </MessageActions>
        )}
      </Fragment>
    );
  };

  return (
    <>
      {segmentMessages(messages).map((segment) => {
        if (segment.type === "message") {
          return renderMessage(
            segment.message,
            messages.indexOf(segment.message),
          );
        }
        const [first] = segment.messages;
        const single = segment.messages.length === 1;
        const reportable = (message: ThreadMessage) =>
          !own && !message.removed && message.attachmentId !== undefined;
        // A photo may be reported as such only once the reader could see it;
        // a pending or removed one reports its message (the caption).
        const photoId = (message: ThreadMessage) => {
          const view = message.attachment;
          return view &&
            !("kind" in view) &&
            (view.status === "ready" || view.status === "blurred")
            ? message.attachmentId
            : undefined;
        };
        const media = hideMedia ? (
          <CollapsedMedia label={t("circle.blockedPhoto")} />
        ) : (
          <MessagePhotos
            messages={segment.messages}
            own={own}
            authorName={otherAuthor}
            authorId={otherAuthorId}
            onMediaLoad={onMediaLoad}
          />
        );
        return (
          <Fragment key={`photos-${first.id}`}>
            {/* One photo carries its message's More menu; in a gallery the
                caption bubble does, and each photo reports from the viewer. */}
            {single && reportable(first) ? (
              <MessageActions
                messageId={first.id}
                body={first.body}
                authorName={otherAuthor}
                authorId={otherAuthorId}
                attachmentId={photoId(first)}
              >
                {media}
              </MessageActions>
            ) : (
              media
            )}
            {segment.messages.map((message) => {
              if (!message.body.trim() || message.removed) return null;
              const bubble = (
                <div
                  key={message.id}
                  title={formatFullDateTime(message.sentAt, locale)}
                  className={cn(
                    BUBBLE_CLASS,
                    own
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                    bubbleCorners(
                      own,
                      messages.indexOf(message),
                      messages.length,
                    ),
                  )}
                >
                  <MessageText body={message.body} />
                </div>
              );
              return !single && reportable(message) ? (
                <MessageActions
                  key={message.id}
                  messageId={message.id}
                  body={message.body}
                  authorName={otherAuthor}
                  authorId={otherAuthorId}
                  attachmentId={photoId(message)}
                >
                  {bubble}
                </MessageActions>
              ) : (
                bubble
              );
            })}
          </Fragment>
        );
      })}
      {!lastPending && (
        <time
          dateTime={new Date(last.sentAt).toISOString()}
          className="text-muted-foreground px-1 pt-0.5 text-xs tabular-nums"
        >
          {formatMessageTime(last.sentAt, locale)}
        </time>
      )}
    </>
  );
}

// A blocked member's photo or location after Show: still collapsed.
function CollapsedMedia({ label }: { label: string }) {
  return (
    <div className="bg-muted/60 text-muted-foreground flex items-center gap-2 rounded-2xl border border-dashed px-3.5 py-2 text-sm">
      <EyeOff aria-hidden className="size-4 shrink-0" />
      {label}
    </div>
  );
}

// Placeholder in the copy card's slot when the referenced copy is gone or no
// longer visible to the reader: same geometry, not a link.
function CopyUnavailableCard({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const t = useTranslations("messages");
  return (
    <div
      className={cn(
        "text-muted-foreground flex w-72 max-w-full items-center gap-3 rounded-lg border border-dashed p-2",
        className,
      )}
    >
      <span className="bg-muted flex size-12 shrink-0 items-center justify-center rounded-md">
        <PuzzleIcon className="size-5" aria-hidden />
      </span>
      <span className="text-sm">{label ?? t("copyUnavailable")}</span>
    </div>
  );
}

// 15px on phones, close to the 16px the composer types at; 14px from md.
const BUBBLE_CLASS =
  "max-w-[min(80%,30rem)] rounded-2xl px-3.5 py-2 text-[15px] leading-5 break-words whitespace-pre-wrap md:text-sm";

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

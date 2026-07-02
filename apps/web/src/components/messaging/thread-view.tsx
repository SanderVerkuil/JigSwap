"use client";

// Active-thread pane of /messages/$threadId: the getThreadMessages
// subscription (ascending), read receipts via markThreadRead, and the
// composer. Reuses the inbox subscription for the header subject — Convex
// dedupes it with the list pane. PROVISIONAL layout per the design doc — all
// data access lives in the messaging components so a designer pass can
// restyle presentation only.
//
// TODO: only the newest page (50 messages) renders — the getThreadMessages
// `before` cursor exists but a "load older messages" affordance is unbuilt.

import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, MessageSquare } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { threadSubjectTitle } from "./format";
import { MessageComposer } from "./message-composer";
import { ThreadSubjectAvatar } from "./thread-list";

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
  const format = useFormatter();
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

  // mutateAsync is referentially stable, so the effect deps below behave as before.
  const { mutateAsync: markThreadRead } = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.markThreadRead),
  });
  const messageCount = messages?.length;
  const newestAuthorId = messages?.at(-1)?.authorId;

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

  const scrollerRef = useRef<HTMLDivElement>(null);
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
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    }
  }, [messageCount, newestAuthorId, me]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thread header — back affordance to the inbox list on mobile only. */}
      {!hideHeader && (
        <div className="flex items-center gap-3 border-b pb-3">
          <Link
            href="/messages"
            aria-label={t("backToInbox")}
            className="hover:bg-accent -ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors md:hidden"
          >
            <ChevronLeft className="size-5" />
          </Link>
          {inbox === undefined ? (
            <div
              className="bg-muted h-10 w-44 animate-pulse rounded"
              aria-hidden
            />
          ) : thread ? (
            <>
              <ThreadSubjectAvatar subject={thread.subject} />
              <p className="font-heading min-w-0 truncate text-base font-bold">
                {threadSubjectTitle(thread.subject, t)}
              </p>
            </>
          ) : (
            // Inbox loaded but this thread isn't in it (e.g. a subject that no
            // longer resolves) — a generic title beats an eternal skeleton.
            <p className="font-heading min-w-0 truncate text-base font-bold">
              {t("threadFallbackTitle")}
            </p>
          )}
        </div>
      )}

      {/* Messages ascending: own right-aligned, system centered and muted. */}
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4"
      >
        {messages === undefined ? (
          <div className="space-y-4" aria-hidden>
            <div className="bg-muted h-12 w-1/2 animate-pulse rounded-lg" />
            <div className="bg-muted ml-auto h-12 w-1/2 animate-pulse rounded-lg" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <div className="bg-muted flex size-12 items-center justify-center rounded-full">
              <MessageSquare className="text-muted-foreground size-6" />
            </div>
            <p className="text-sm font-medium">{t("noMessages")}</p>
            <p className="text-muted-foreground text-xs">
              {t("noMessagesHint")}
            </p>
          </div>
        ) : (
          messages.map((message) => {
            if (message.kind === "system") {
              return (
                <div key={message.id} className="flex justify-center">
                  {/* System (lifecycle) messages: the body renders as-is, muted. */}
                  <p className="text-muted-foreground max-w-md text-center text-xs">
                    {message.body}
                  </p>
                </div>
              );
            }
            const own = message.authorId === me;
            return (
              <div
                key={message.id}
                className={cn("flex", own ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-xs rounded-lg px-4 py-2 lg:max-w-md",
                    own ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  <p className="text-sm break-words whitespace-pre-wrap">
                    {message.body}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-xs",
                      own
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground",
                    )}
                  >
                    {format.dateTime(new Date(message.sentAt), {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <MessageComposer threadId={threadId} />
    </div>
  );
}

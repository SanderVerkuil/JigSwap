"use client";

// Active-thread pane of /messages/$threadId: the getThreadMessages
// subscription (ascending), read receipts via markThreadRead, and the
// composer. Reuses the inbox subscription for the header subject — Convex
// dedupes it with the list pane. PROVISIONAL layout per the design doc — all
// data access lives in the messaging components so a designer pass can
// restyle presentation only.

import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway } from "@/gateway";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, MessageSquare } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { MessageComposer } from "./message-composer";
import { ThreadSubjectAvatar, threadSubjectTitle } from "./thread-list";

export function ThreadView({ threadId }: { threadId: string }) {
  const t = useTranslations("messages");
  const format = useFormatter();
  const { member } = useCurrentMember();
  const me = member?._id;

  const messages = useQuery(
    gateway.conversation.getThreadMessages,
    me ? { threadId } : "skip",
  );
  const inbox = useQuery(gateway.conversation.getMyInbox, me ? {} : "skip");
  const thread = inbox?.find((row) => row.threadId === threadId);

  const markThreadRead = useMutation(gateway.conversation.markThreadRead);
  const messageCount = messages?.length;
  useEffect(() => {
    // Mark read once the subscription has data and again whenever new
    // messages land — never while loading or unauthenticated.
    if (!me || messageCount === undefined) return;
    markThreadRead({ threadId }).catch(() => {
      // Non-fatal: the receipt catches up on the next message.
    });
  }, [me, messageCount, threadId, markThreadRead]);

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thread header — back affordance to the inbox list on mobile only. */}
      <div className="flex items-center gap-3 border-b pb-3">
        <Link
          href="/messages"
          aria-label={t("backToInbox")}
          className="hover:bg-accent -ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors md:hidden"
        >
          <ChevronLeft className="size-5" />
        </Link>
        {thread ? (
          <>
            <ThreadSubjectAvatar subject={thread.subject} />
            <p className="font-heading min-w-0 truncate text-base font-bold">
              {threadSubjectTitle(thread.subject, t)}
            </p>
          </>
        ) : (
          <div
            className="bg-muted h-10 w-44 animate-pulse rounded"
            aria-hidden
          />
        )}
      </div>

      {/* Messages ascending: own right-aligned, system centered and muted. */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
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
        <div ref={endRef} />
      </div>

      <MessageComposer threadId={threadId} />
    </div>
  );
}

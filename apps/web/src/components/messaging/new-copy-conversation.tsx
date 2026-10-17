"use client";

// The /messages/new?copy=<id> pane: where a copy's "Message" action lands. The backend resolves
// the counterpart from the copy (getCopyConversation): an existing DM with the owner is opened
// directly; otherwise this shows a composer pre-addressed to the owner with the puzzle attached,
// and the DM is created only when the first message is sent (startCopyConversation).

import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { gateway, type Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { MessageCopyCard } from "./copy-card";
import { conversationErrorCode, threadSubjectTitle } from "./format";
import { ThreadSubjectAvatar } from "./thread-list";

// The Thread aggregate rejects longer bodies (ConvexError code MessageTooLong).
const MAX_MESSAGE_LENGTH = 4000;

export function NewCopyConversation({ copyId }: { copyId: string }) {
  const t = useTranslations("copyConversation");
  const tMessages = useTranslations("messages");
  const displayName = useMemberDisplayName();
  const navigate = useNavigate();
  const { member } = useCurrentMember();
  const me = member?._id;

  const { data: view, isError } = useQuery(
    convexQuery(
      gateway.conversation.getCopyConversation,
      me ? { copyId: copyId as Id<"ownedPuzzles"> } : "skip",
    ),
  );

  // An existing DM with the owner: open it instead of starting a second one.
  const existingThreadId =
    view?.status === "existing" ? view.threadId : undefined;
  useEffect(() => {
    if (existingThreadId) {
      void navigate({
        to: "/messages/$threadId",
        params: { threadId: existingThreadId },
        replace: true,
      });
    }
  }, [existingThreadId, navigate]);

  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: useConvexMutation(gateway.conversation.startCopyConversation),
  });

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || start.isPending) return;
    setError(null);
    try {
      const threadId = await start.mutateAsync({
        copyId: copyId as Id<"ownedPuzzles">,
        body: trimmed,
      });
      await navigate({
        to: "/messages/$threadId",
        params: { threadId },
        replace: true,
      });
    } catch (err) {
      const code = conversationErrorCode(err);
      setError(
        code === "MessageTooLong"
          ? tMessages("tooLong")
          : code === "NotConnected"
            ? tMessages("notConnected")
            : tMessages("sendError"),
      );
    }
  };

  const backLink = (
    <Link
      href="/messages"
      aria-label={tMessages("backToInbox")}
      className="hover:bg-accent -ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors md:hidden"
    >
      <ChevronLeft className="size-5" />
    </Link>
  );

  if (isError || view?.status === "unavailable" || view?.status === "self") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium">
          {view?.status === "self" ? t("self") : t("unavailable")}
        </p>
        {view?.status === "self" && (
          <Link
            href={`/copies/${copyId}`}
            className="text-primary text-sm underline-offset-4 hover:underline"
          >
            {t("backToPuzzle")}
          </Link>
        )}
      </div>
    );
  }

  if (view === undefined || view.status === "existing") {
    return (
      <div className="flex min-h-0 flex-1 flex-col" aria-busy>
        <div className="bg-muted h-10 w-44 animate-pulse rounded" />
      </div>
    );
  }

  const subject = { kind: "dm" as const, otherMember: view.owner };
  const ownerName = threadSubjectTitle(subject, tMessages, displayName);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b pb-3">
        {backLink}
        <ThreadSubjectAvatar subject={subject} />
        <p className="font-heading min-w-0 truncate text-base font-bold">
          {t("title", { name: ownerName })}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 py-4">
        <p className="text-muted-foreground text-xs">{t("firstMessageHint")}</p>
      </div>

      <div className="border-t pt-3">
        <p className="text-muted-foreground mb-1.5 text-xs font-medium">
          {t("aboutPuzzle")}
        </p>
        <MessageCopyCard copy={view.copy} className="mb-2 max-w-sm" />
        {view.canMessage ? (
          <div className="flex items-end gap-2">
            <Textarea
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter inserts a newline (same as the thread composer).
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={2}
              className="max-h-40 min-h-9 flex-1 resize-none"
            />
            <Button
              onClick={() => void send()}
              disabled={!body.trim() || start.isPending}
              size="sm"
              aria-label={tMessages("sendMessage")}
            >
              <Send className="size-4" />
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {tMessages("notConnected")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive mt-1.5 text-xs">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

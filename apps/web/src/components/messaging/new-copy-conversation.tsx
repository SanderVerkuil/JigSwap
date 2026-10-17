"use client";

// The /messages/new?copy=<id> pane: where a copy's "Message" action lands. The backend resolves
// the counterpart from the copy (getCopyConversation): an existing DM with the owner is opened
// directly; otherwise this shows a composer pre-addressed to the owner with the puzzle attached,
// and the DM is created only when the first message is sent (startCopyConversation).
import { Link } from "@/compat/link";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { gateway, type Id } from "@/gateway";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { MessageCopyCard } from "./copy-card";
import { conversationErrorCode, threadSubjectTitle } from "./format";
import { ThreadSubjectAvatar } from "./thread-list";
import { BackToInboxLink } from "./thread-view";

// The Thread aggregate rejects longer bodies (ConvexError code MessageTooLong).
const MAX_MESSAGE_LENGTH = 4000;

export function NewCopyConversation({ copyId }: { copyId: string }) {
  const t = useTranslations("copyConversation");
  const tMessages = useTranslations("messages");
  const displayName = useMemberDisplayName();
  const navigate = useNavigate();
  // The shell top bar (and its h1) is hidden here on phones.
  const Heading = useIsMobile() ? "h1" : "h2";
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

  // Desktop lands the caret in the composer; phones wait for a tap so the
  // keyboard doesn't cover the screen unasked.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerReady = view?.status === "new" && view.canMessage;
  useEffect(() => {
    if (!composerReady) return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    textareaRef.current?.focus();
  }, [composerReady]);

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

  const backLink = <BackToInboxLink />;

  if (isError || view?.status === "unavailable" || view?.status === "self") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center px-2 md:hidden">
          {backLink}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-sm font-medium">
            {view?.status === "self" ? t("self") : t("unavailable")}
          </p>
          {view?.status === "self" && (
            <Link
              href={`/copies/${copyId}`}
              className="text-primary-text text-sm underline-offset-4 hover:underline"
            >
              {t("backToPuzzle")}
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (view === undefined || view.status === "existing") {
    return (
      <div className="flex min-h-0 flex-1 flex-col" aria-busy>
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-2 md:px-4">
          {backLink}
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>
    );
  }

  const subject = { kind: "dm" as const, otherMember: view.owner };
  const ownerName = threadSubjectTitle(subject, tMessages, displayName);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="bg-card shrink-0 border-b pt-[env(safe-area-inset-top)] md:pt-0">
        <div className="flex h-14 items-center gap-3 px-2 md:px-4">
          {backLink}
          <ThreadSubjectAvatar subject={subject} className="size-9" />
          <Heading className="font-heading min-w-0 flex-1 truncate text-base font-bold">
            {t("title", { name: ownerName })}
          </Heading>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 px-3 py-4 md:px-6">
        <p className="text-muted-foreground text-center text-xs">
          {t("firstMessageHint")}
        </p>
      </div>

      <div className="bg-card shrink-0 border-t px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:px-4 md:pb-3">
        <p className="text-muted-foreground mb-1.5 text-xs font-medium">
          {t("aboutPuzzle")}
        </p>
        <MessageCopyCard copy={view.copy} className="mb-2 w-72 max-w-full" />
        {view.canMessage ? (
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
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
              aria-label={tMessages("messageName", { name: ownerName })}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={1}
              // muted-foreground lifts the outline to ≥3:1 (--input is ~1.3:1).
              className="border-muted-foreground/80 dark:border-muted-foreground/60 max-h-40 min-h-11 flex-1 resize-none rounded-[20px] px-4 py-2.5 md:min-h-10"
            />
            <Button
              onClick={() => void send()}
              disabled={!body.trim() || start.isPending}
              size="icon"
              className="size-11 rounded-full md:size-10"
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

"use client";

// Composer under the active thread. Sends text messages (optionally with one
// attached puzzle copy, picked via AttachPicker) with an optimistic
// append into the exact getThreadMessages subscription the thread view holds
// (the established withOptimisticUpdate pattern — see use-favorites); Convex
// replaces the local patch when the server result streams back, so pending
// messages clear themselves. Layout per the message-center redesign spec §7.
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { conversationErrorCode } from "@/components/messaging/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { gateway, type Id } from "@/gateway";
import { useConvexMutation } from "@convex-dev/react-query";
import { useMutation } from "@tanstack/react-query";
import type { OptimisticUpdate } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import { Puzzle, Send } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";
import { AttachPicker } from "./attach-picker";
import type { MessageCopy } from "./copy-card";
import { StagedCopyChip } from "./staged-copy-chip";

// The Thread aggregate rejects longer bodies (ConvexError code MessageTooLong).
const MAX_MESSAGE_LENGTH = 4000;

type PostMessageArgs = FunctionArgs<typeof gateway.conversation.postMessage>;

// Append the message locally to the { threadId }-only subscription the thread
// view holds; Convex reverts the patch when the mutation settles. Module-level
// factory so the impure Date.now()/randomUUID calls stay out of render.
const optimisticAppend =
  (
    me: string | undefined,
    staged: MessageCopy | null,
  ): OptimisticUpdate<PostMessageArgs> =>
  (localStore, args) => {
    if (!me) return;
    const current = localStore.getQuery(
      gateway.conversation.getThreadMessages,
      { threadId: args.threadId },
    );
    if (current === undefined) return;
    localStore.setQuery(
      gateway.conversation.getThreadMessages,
      { threadId: args.threadId },
      [
        ...current,
        {
          id: `pending-${crypto.randomUUID()}`,
          authorId: me,
          kind: args.kind,
          body: args.body,
          sentAt: Date.now(),
          // The staged card is already loaded — show it on the pending bubble.
          ...(staged && args.copyId === staged.copyId ? { copy: staged } : {}),
        },
      ],
    );
  };

export function MessageComposer({
  threadId,
  recipientName,
  theirsLabel,
}: {
  threadId: string;
  // Names the textarea ("Message Esther"); falls back to the generic label.
  recipientName?: string;
  // The attach picker's tab for the other member's copies; null hides it.
  theirsLabel: string | null;
}) {
  const t = useTranslations("messages");
  const { member } = useCurrentMember();
  const me = member?._id;

  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<MessageCopy | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const postMessage = useMutation({
    mutationFn: useConvexMutation(
      gateway.conversation.postMessage,
    ).withOptimisticUpdate(optimisticAppend(me, staged)),
  });

  const send = async () => {
    const trimmed = body.trim();
    // A message always carries text; an attachment rides along with it.
    if (!trimmed || !me) return;
    const copy = staged;
    setError(null);
    // Clear immediately — the optimistic append already shows the message.
    setBody("");
    setStaged(null);
    try {
      await postMessage.mutateAsync({
        threadId,
        kind: "text",
        body: trimmed,
        ...(copy ? { copyId: copy.copyId as Id<"ownedPuzzles"> } : {}),
      });
    } catch (err) {
      // Give the text back unless the user already started typing a new one.
      setBody((current) => current || trimmed);
      const code = conversationErrorCode(err);
      if (code === "CopyNotFound") {
        // The copy went away or out of view since it was picked: drop it.
        toast.error(t("copyNotFound"));
        return;
      }
      if (copy) setStaged((current) => current ?? copy);
      setError(code === "MessageTooLong" ? t("tooLong") : t("sendError"));
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="bg-card shrink-0 border-t px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:px-4 md:pb-3">
      {staged && (
        <StagedCopyChip
          copy={staged}
          onRemove={() => {
            setStaged(null);
            textareaRef.current?.focus();
          }}
        />
      )}
      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground size-11 rounded-full md:size-10"
          onClick={() => setPickerOpen(true)}
          aria-label={t("attachPuzzle")}
        >
          <Puzzle className="size-5" />
        </Button>
        <Textarea
          ref={textareaRef}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("typeMessage")}
          aria-label={
            recipientName
              ? t("messageName", { name: recipientName })
              : t("typeMessage")
          }
          maxLength={MAX_MESSAGE_LENGTH}
          rows={1}
          // muted-foreground lifts the outline to ≥3:1 (--input is ~1.3:1).
          className="border-muted-foreground/80 dark:border-muted-foreground/60 max-h-40 min-h-11 flex-1 resize-none rounded-[20px] px-4 py-2.5 md:min-h-10"
        />
        <Button
          onClick={() => void send()}
          disabled={!body.trim() || !me}
          size="icon"
          className="size-11 rounded-full md:size-10"
          aria-label={t("sendMessage")}
        >
          <Send className="size-4" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive mt-1.5 text-xs">
          {error}
        </p>
      )}
      <AttachPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        threadId={threadId}
        theirsLabel={theirsLabel}
        onSelect={(copy) => {
          setStaged(copy);
          // After the picker's close animation returns focus to the trigger.
          setTimeout(() => textareaRef.current?.focus(), 0);
        }}
      />
    </div>
  );
}

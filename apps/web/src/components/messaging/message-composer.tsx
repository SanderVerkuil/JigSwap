"use client";

// Composer under the active thread. Sends text messages with an optimistic
// append into the exact getThreadMessages subscription the thread view holds
// (the established withOptimisticUpdate pattern — see use-favorites); Convex
// replaces the local patch when the server result streams back, so pending
// messages clear themselves. PROVISIONAL layout per the design doc.

import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { gateway } from "@/gateway";
import type { OptimisticUpdate } from "convex/browser";
import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { ConvexError } from "convex/values";
import { Send } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

// The Thread aggregate rejects longer bodies (ConvexError code MessageTooLong).
const MAX_MESSAGE_LENGTH = 4000;

// Pull the stable domain error code out of a mutation rejection.
function conversationErrorCode(error: unknown): string | undefined {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: unknown } | undefined;
    if (data && typeof data.code === "string") return data.code;
  }
  return undefined;
}

type PostMessageArgs = FunctionArgs<typeof gateway.conversation.postMessage>;

// Append the message locally to the { threadId }-only subscription the thread
// view holds; Convex reverts the patch when the mutation settles. Module-level
// factory so the impure Date.now()/randomUUID calls stay out of render.
const optimisticAppend =
  (me: string | undefined): OptimisticUpdate<PostMessageArgs> =>
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
        },
      ],
    );
  };

export function MessageComposer({ threadId }: { threadId: string }) {
  const t = useTranslations("messages");
  const { member } = useCurrentMember();
  const me = member?._id;

  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const postMessage = useMutation(
    gateway.conversation.postMessage,
  ).withOptimisticUpdate(optimisticAppend(me));

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || !me) return;
    setError(null);
    // Clear immediately — the optimistic append already shows the message.
    setBody("");
    try {
      await postMessage({ threadId, kind: "text", body: trimmed });
    } catch (err) {
      // Give the text back unless the user already started typing a new one.
      setBody((current) => current || trimmed);
      setError(
        conversationErrorCode(err) === "MessageTooLong"
          ? t("tooLong")
          : t("sendError"),
      );
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
    <div className="border-t pt-3">
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("typeMessage")}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={1}
          className="max-h-40 min-h-9 flex-1 resize-none"
        />
        <Button
          onClick={() => void send()}
          disabled={!body.trim() || !me}
          size="sm"
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
    </div>
  );
}

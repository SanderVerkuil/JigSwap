import { parseThreadSearch } from "@/components/messaging/copy-conversation";
import {
  LIST_PANE_CLASS,
  MESSAGES_FRAME_CLASS,
  MESSAGES_IMMERSIVE_CLASS,
} from "@/components/messaging/frame";
import { ThreadList } from "@/components/messaging/thread-list";
import { ThreadView } from "@/components/messaging/thread-view";
import { AppNotFound } from "@/components/NotFound";
import { pageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import {
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";

// This route is deep-linked (message notifications carry thread ids), so a
// stale or foreign id surfaces here as a ConvexError from listThreadMessages.
// Render those as the in-shell 404 and rethrow anything else to the default
// catch boundary.
function ThreadError({ error }: ErrorComponentProps) {
  if (error instanceof ConvexError) {
    const code = (error.data as { code?: unknown } | undefined)?.code;
    if (code === "ThreadNotFound" || code === "NotParticipant") {
      return <AppNotFound />;
    }
  }
  throw error;
}

export const Route = createFileRoute("/_dashboard/messages/$threadId")({
  validateSearch: parseThreadSearch,
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
  errorComponent: ThreadError,
  component: MessageThreadPage,
});

// Active-thread route: list + thread in one frame once the frame is wide
// enough to split (frame.ts), otherwise just the thread with a back link to
// /messages in its header. On phones the thread goes full-screen (the shell
// bars step aside — isImmersiveMobileRoute).
// Deliberately thin — all data access lives in the messaging components.
function MessageThreadPage() {
  const { threadId } = Route.useParams();
  const { attach } = Route.useSearch();
  const navigate = Route.useNavigate();
  // ?attach=<copyId>: a copy's "Message" brought its puzzle along. The page keeps the id for the
  // composer and takes it off the URL straight away, so a reload or a shared link stages nothing.
  const [attachCopyId] = useState(attach);
  useEffect(() => {
    if (attach) {
      void navigate({ search: {}, replace: true, resetScroll: false });
    }
  }, [attach, navigate]);

  return (
    <div className={cn(MESSAGES_IMMERSIVE_CLASS, MESSAGES_FRAME_CLASS)}>
      <div className={LIST_PANE_CLASS}>
        <ThreadList activeThreadId={threadId} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ThreadView threadId={threadId} attachCopyId={attachCopyId} />
      </div>
    </div>
  );
}

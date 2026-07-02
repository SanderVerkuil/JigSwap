import { pageTitle } from "@/lib/page-title";
import {
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { ConvexError } from "convex/values";

import { AppNotFound } from "@/components/NotFound";
import { ThreadList } from "@/components/messaging/thread-list";
import { ThreadView } from "@/components/messaging/thread-view";

// This route is deep-linked (message notifications carry thread ids), so a
// stale or foreign id surfaces here as a ConvexError from getThreadMessages.
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
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
  errorComponent: ThreadError,
  component: MessageThreadPage,
});

// Active-thread route: list + thread on desktop; on mobile just the thread
// (the ThreadView header carries the back affordance to /messages).
// Deliberately thin — all data access lives in the messaging components
// (provisional layout, designer pass pending).
function MessageThreadPage() {
  const { threadId } = Route.useParams();

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] gap-6">
      <div className="hidden w-80 max-w-xs flex-col md:flex">
        <ThreadList activeThreadId={threadId} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col md:border-l md:pl-6">
        <ThreadView threadId={threadId} />
      </div>
    </div>
  );
}

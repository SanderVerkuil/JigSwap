import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { ThreadList } from "@/components/messaging/thread-list";
import { ThreadView } from "@/components/messaging/thread-view";

export const Route = createFileRoute("/_dashboard/messages/$threadId")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
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

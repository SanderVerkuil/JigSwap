import { parseCopyMessageSearch } from "@/components/messaging/copy-conversation";
import {
  LIST_PANE_CLASS,
  MESSAGES_FRAME_CLASS,
  MESSAGES_IMMERSIVE_CLASS,
} from "@/components/messaging/frame";
import { NewCopyConversation } from "@/components/messaging/new-copy-conversation";
import { ThreadList } from "@/components/messaging/thread-list";
import { pageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { createFileRoute, redirect } from "@tanstack/react-router";

// New conversation about a copy: /messages/new?copy=<ownedPuzzleId>. Only the copy travels in
// the URL — the backend derives the recipient (the copy's owner). Same list + pane layout as
// /messages/$threadId; the pane redirects into an existing DM with the owner when there is one.
// Without a copy (a stale or hand-typed URL) there is nothing to start: go to the inbox.
export const Route = createFileRoute("/_dashboard/messages/new")({
  validateSearch: parseCopyMessageSearch,
  beforeLoad: ({ search }) => {
    if (!search.copy) throw redirect({ to: "/messages", replace: true });
  },
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
  component: NewMessagePage,
});

function NewMessagePage() {
  const { copy } = Route.useSearch();

  return (
    <div className={cn(MESSAGES_IMMERSIVE_CLASS, MESSAGES_FRAME_CLASS)}>
      <div className={LIST_PANE_CLASS}>
        <ThreadList />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* beforeLoad sends a missing copy to the inbox. */}
        {copy && <NewCopyConversation key={copy} copyId={copy} />}
      </div>
    </div>
  );
}

import {
  INBOX_LIST_PANE_CLASS,
  MESSAGES_FRAME_CLASS,
  SPLIT_ONLY_CLASS,
} from "@/components/messaging/frame";
import { InboxGuide } from "@/components/messaging/inbox-guide";
import { ThreadList } from "@/components/messaging/thread-list";
import { pageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/messages/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
  component: MessagesIndexPage,
});

// Inbox route: the thread list (the whole frame without a split) plus, once
// the frame is wide enough to split, a pane saying what Messages is for.
// Deliberately thin — all data access lives in the messaging components.
function MessagesIndexPage() {
  return (
    <div className={MESSAGES_FRAME_CLASS}>
      <div className={INBOX_LIST_PANE_CLASS}>
        <ThreadList guideBeside />
      </div>
      <div
        className={cn(
          SPLIT_ONLY_CLASS,
          "min-w-0 flex-1 flex-col items-center justify-center px-6",
        )}
      >
        <InboxGuide />
      </div>
    </div>
  );
}

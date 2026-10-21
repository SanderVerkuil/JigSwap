import { MESSAGES_FRAME_CLASS } from "@/components/messaging/frame";
import { InboxGuide } from "@/components/messaging/inbox-guide";
import { ThreadList } from "@/components/messaging/thread-list";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_dashboard/messages/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
  component: MessagesIndexPage,
});

// Inbox route: the thread list (full width on mobile) plus, on desktop, a
// pane saying what Messages is for, in one frame. Deliberately thin —
// all data access lives in the messaging components.
function MessagesIndexPage() {
  return (
    <div className={MESSAGES_FRAME_CLASS}>
      <div className="flex flex-col md:w-[340px] md:shrink-0 md:border-r xl:w-[360px]">
        <ThreadList guideBeside />
      </div>
      <div className="hidden min-w-0 flex-1 flex-col items-center justify-center px-6 md:flex">
        <InboxGuide />
      </div>
    </div>
  );
}

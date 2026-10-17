import { MESSAGES_FRAME_CLASS } from "@/components/messaging/frame";
import { ThreadList } from "@/components/messaging/thread-list";
import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/messages/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
  component: MessagesIndexPage,
});

// Inbox route: the thread list (full width on mobile) plus a pick-a-
// conversation placeholder pane on desktop, in one frame. Deliberately thin —
// all data access lives in the messaging components.
function MessagesIndexPage() {
  const t = useTranslations("messages");

  return (
    <div className={MESSAGES_FRAME_CLASS}>
      <div className="flex flex-col md:w-[340px] md:shrink-0 md:border-r xl:w-[360px]">
        <ThreadList />
      </div>
      <div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center md:flex">
        <div className="bg-muted flex size-12 items-center justify-center rounded-full">
          <MessageSquare className="text-muted-foreground size-6" />
        </div>
        <h2 className="font-heading text-lg font-bold">
          {t("selectConversation")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("selectConversationHint")}
        </p>
      </div>
    </div>
  );
}

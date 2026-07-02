import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { ThreadList } from "@/components/messaging/thread-list";
import { useTranslations } from "use-intl";

export const Route = createFileRoute("/_dashboard/messages/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
  component: MessagesIndexPage,
});

// Inbox route: the thread list (full width on mobile) plus a pick-a-
// conversation placeholder pane on desktop. Deliberately thin — all data
// access lives in the messaging components (provisional layout, designer
// pass pending).
function MessagesIndexPage() {
  const t = useTranslations("messages");

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] gap-6">
      <div className="flex w-full flex-col md:w-80 md:max-w-xs">
        <ThreadList />
      </div>
      <div className="hidden min-w-0 flex-1 items-center justify-center border-l pl-6 md:flex">
        <div className="text-center">
          <div className="mb-2 text-[34px] leading-none" aria-hidden>
            🧩
          </div>
          <h3 className="font-heading text-lg font-bold">
            {t("selectConversation")}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t("selectConversationHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

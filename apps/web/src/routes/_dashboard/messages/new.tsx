import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { parseCopyMessageSearch } from "@/components/messaging/copy-conversation";
import { NewCopyConversation } from "@/components/messaging/new-copy-conversation";
import { ThreadList } from "@/components/messaging/thread-list";
import { useTranslations } from "use-intl";

// New conversation about a copy: /messages/new?copy=<ownedPuzzleId>. Only the copy travels in
// the URL — the backend derives the recipient (the copy's owner). Same list + pane layout as
// /messages/$threadId; the pane redirects into an existing DM with the owner when there is one.
export const Route = createFileRoute("/_dashboard/messages/new")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
  validateSearch: parseCopyMessageSearch,
  component: NewMessagePage,
});

function NewMessagePage() {
  const { copy } = Route.useSearch();
  const t = useTranslations("copyConversation");

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[420px] gap-6">
      <div className="hidden w-80 max-w-xs flex-col md:flex">
        <ThreadList />
      </div>
      <div className="flex min-w-0 flex-1 flex-col md:border-l md:pl-6">
        {copy ? (
          <NewCopyConversation key={copy} copyId={copy} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-center">
            <p className="text-sm font-medium">{t("unavailable")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

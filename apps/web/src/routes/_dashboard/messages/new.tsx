import { parseCopyMessageSearch } from "@/components/messaging/copy-conversation";
import {
  LIST_PANE_CLASS,
  MESSAGES_FRAME_CLASS,
  MESSAGES_IMMERSIVE_CLASS,
} from "@/components/messaging/frame";
import { NewCopyConversation } from "@/components/messaging/new-copy-conversation";
import { ThreadList } from "@/components/messaging/thread-list";
import { BackToInboxLink } from "@/components/messaging/thread-view";
import { pageTitle } from "@/lib/page-title";
import { cn } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
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
    <div className={cn(MESSAGES_IMMERSIVE_CLASS, MESSAGES_FRAME_CLASS)}>
      <div className={LIST_PANE_CLASS}>
        <ThreadList />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {copy ? (
          <NewCopyConversation key={copy} copyId={copy} />
        ) : (
          <>
            <div className="flex h-14 shrink-0 items-center px-2 md:hidden">
              <BackToInboxLink />
            </div>
            <div className="flex flex-1 items-center justify-center px-4 text-center">
              <p className="text-sm font-medium">{t("unavailable")}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

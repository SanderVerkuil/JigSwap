import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import {
  threadSubjectTitle,
  type Translator,
} from "@/components/messaging/format";
import { InboxWindowProvider } from "@/components/messaging/inbox-window";
import { NewConversationMenu } from "@/components/messaging/new-conversation-menu";
import { threadsToToast } from "@/components/messaging/new-message-toasts";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import usePresence from "@convex-dev/presence/react";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import * as React from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

// Layout for /messages: heartbeats the shared "messages" presence room (so the
// backend's presenceGate can suppress message_received notifications while the
// member is here — see notifications/presenceGate.ts) and watches the inbox
// for messages landing in threads the member isn't currently looking at,
// surfacing those as an in-tab toast instead.
export const Route = createFileRoute("/_dashboard/messages")({
  component: MessagesLayout,
});

function MessagesLayout() {
  const { member } = useCurrentMember();
  // "New" lives in the page head (and the phone actions row), not in the list.
  // Republished per thread: a dead thread's not-found clears the head when it
  // unmounts, and React runs that cleanup before this effect runs again.
  const { threadId } = useParams({ strict: false });
  usePageHeaderActions(() => <NewConversationMenu />, [threadId]);
  // The inbox list's window ("Show older conversations") lives here, so it
  // survives moving between the inbox and a thread.
  return (
    <InboxWindowProvider>
      {member ? <MessagesPresence memberId={member._id} /> : null}
      <MessageToastWatcher />
      <Outlet />
    </InboxWindowProvider>
  );
}

// Isolated so the presence hook only mounts once the member id is known
// (hooks can't be conditional).
function MessagesPresence({ memberId }: { memberId: string }) {
  // 30 s keeps heartbeat calls low; a tab that vanishes without unloading
  // still drops out of the room after 2.5 intervals (75 s worst case, during
  // which new messages send no bell, email or push).
  usePresence(gateway.presence, "messages", memberId, 30_000);
  return null;
}

// Toasts "new message from X" for inbox threads whose latest message advanced
// since the last render, when that message wasn't authored by the viewer and
// the thread isn't the one currently open (threadsToToast). Skips the very
// first load (nothing to compare against yet) so opening /messages never
// toast-storms the existing inbox. It watches the inbox's newest page (the
// default getMyInbox window), which a new message always lifts its thread into.
function MessageToastWatcher() {
  const t = useTranslations("notifications");
  const tMessages = useTranslations("messages");
  const displayName = useMemberDisplayName();
  const navigate = useNavigate();
  const { member } = useCurrentMember();
  const { threadId: activeThreadId } = useParams({ strict: false });
  const { data: inbox } = useQuery(
    convexQuery(gateway.conversation.getMyInbox, member?._id ? {} : "skip"),
  );
  const lastSeen = React.useRef<Map<string, number> | null>(null);

  React.useEffect(() => {
    if (!inbox || !member) return;
    const { toToast, seen } = threadsToToast(
      inbox,
      lastSeen.current,
      activeThreadId,
    );
    for (const thread of toToast) {
      const name = threadSubjectTitle(
        thread.subject,
        tMessages as Translator,
        displayName,
      );
      toast(
        thread.subject.kind === "circle"
          ? t("newCircleMessageToast", { circle: name })
          : t("newMessageToast", { name }),
        {
          action: {
            label: t("newMessageToastOpen"),
            onClick: () => {
              void navigate({
                to: "/messages/$threadId",
                params: { threadId: thread.threadId },
              });
            },
          },
        },
      );
    }
    lastSeen.current = seen;
  }, [inbox, member, activeThreadId, navigate, t, tMessages, displayName]);

  return null;
}

"use client";

// The thread header's overflow menu, at every width: actions on the thread's
// other participant (Block; Report follows in milestone A6). Renders nothing
// when the partner isn't known to the viewer or is already blocked by them
// (the composer slot's banner then offers Unblock).
import { MemberActionsMenu } from "@/components/social/member-actions-menu";
import type { Id } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { MoreVertical } from "lucide-react";
import { useTranslations } from "use-intl";
import type { InboxThread } from "./format";
import { threadPartner } from "./thread-partner";

export function ThreadActions({ thread }: { thread: InboxThread }) {
  const t = useTranslations("safety");
  const displayName = useMemberDisplayName();
  const partner = threadPartner(thread);
  if (!partner || thread.blocked === "byMe") return null;

  return (
    <MemberActionsMenu
      memberId={partner._id as Id<"users">}
      name={displayName(partner)}
      label={t("threadActions")}
      icon={MoreVertical}
      className="ml-auto"
    />
  );
}

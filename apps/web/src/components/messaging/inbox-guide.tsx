"use client";

// The desktop pane beside the inbox when no conversation is open: a short
// title and the three ways conversations happen, so the empty pane says what
// Messages is for. With an empty inbox there is nothing to select, so the
// title invites a first conversation instead (the list then drops its own
// hint on desktop; see ThreadList's guideBeside).
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { gateway } from "@/gateway";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, UserRound, Users } from "lucide-react";
import { useTranslations } from "use-intl";

const WAYS = [
  { key: "member", Icon: UserRound },
  { key: "exchange", Icon: ArrowLeftRight },
  { key: "circle", Icon: Users },
] as const;

export function InboxGuide() {
  const t = useTranslations("messages");
  const { member } = useCurrentMember();
  const { data: inbox } = useQuery(
    convexQuery(gateway.conversation.getMyInbox, member?._id ? {} : "skip"),
  );
  const empty = inbox?.length === 0;

  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <h2 className="font-heading text-center text-lg font-bold">
        {empty ? t("guide.startTitle") : t("selectConversation")}
      </h2>
      <ul role="list" className="flex flex-col gap-4">
        {WAYS.map(({ key, Icon }) => (
          <li key={key} className="flex items-start gap-3">
            <span
              aria-hidden
              className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
            >
              <Icon className="size-4" />
            </span>
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground font-medium">
                {t(`guide.${key}.title`)}
              </span>
              <br />
              {t(`guide.${key}.text`)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

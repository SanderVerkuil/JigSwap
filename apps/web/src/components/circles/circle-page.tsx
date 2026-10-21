"use client";

// A circle's own page (/circles/$circleId, G6b): the name with the member
// avatar stack and the existing manage / leave actions, the latest few group
// chat messages with "Open group chat", and the copies shared in the circle.
// Everything is read through member-gated queries: a non-member, an ex-member
// and an unknown id all get the same in-shell 404 (getCircle returns null), so
// the page never tells whether a circle exists.
import { useUser } from "@/compat/clerk";
import {
  canManageCircle,
  canShareInCircle,
} from "@/components/circles/circle-admin-sections";
import { CircleAvatarStack } from "@/components/circles/circle-avatar-stack";
import {
  useCircleSeatName,
  type CircleMemberView,
} from "@/components/circles/circle-seat";
import { CircleShareSection } from "@/components/circles/circle-share-section";
import { LeaveCircleAction } from "@/components/circles/leave-circle-action";
import { ManageCircleDialog } from "@/components/circles/manage-circle-dialog";
import { CoverChip } from "@/components/community/primitives";
import { useCurrentMember } from "@/components/dashboard-home/use-current-member";
import { usePageHeader } from "@/components/dashboard-layout/page-header-slot";
import { MemberInitial } from "@/components/members/member-initial";
import { CircleThreadAvatar } from "@/components/messaging/circle-thread-avatar";
import { MessageCopyCard } from "@/components/messaging/copy-card";
import {
  circleSnippet,
  formatCompactTime,
  formatFullDateTime,
  systemEventText,
} from "@/components/messaging/format";
import { OpenCircleChatButton } from "@/components/messaging/open-circle-chat";
import { AppNotFound } from "@/components/NotFound";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageLoading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { useMemberDisplayName } from "@/lib/member-display-name";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Clock, Settings, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocale, useNow, useTranslations } from "use-intl";

// How many of the newest chat messages the page previews.
export const CHAT_PREVIEW_SIZE = 5;

export function CirclePage({ circleId }: { circleId: string }) {
  const t = useTranslations("circles");
  const navigate = useNavigate();
  const { user } = useUser();
  const seatName = useCircleSeatName();
  const [manageOpen, setManageOpen] = useState(false);
  const { data: detail, isPending } = useQuery(
    convexQuery(gateway.sharing.circle, { circleId }),
  );

  // The shell page head reads Community › Circles › <name>.
  usePageHeader(() => ({ title: detail?.name }), [detail?.name]);

  if (isPending || detail === undefined) {
    return <PageLoading message={t("manage.loadingCircle")} />;
  }
  if (detail === null) return <AppNotFound />;

  const backToList = () => void navigate({ to: "/circles" });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex min-w-0 items-center gap-4">
          {detail.iconUrl ? (
            <CircleThreadAvatar
              members={[]}
              iconUrl={detail.iconUrl}
              className="size-[52px]"
            />
          ) : (
            <CoverChip icon={Users} size={52} gradientIndex={0} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <h2 className="font-heading min-w-0 text-xl font-bold break-words">
                {detail.name}
              </h2>
              <Badge variant="secondary">
                {detail.isOwnedByViewer ? t("roleOwner") : t("roleMember")}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {t("page.memberCount", { count: detail.memberCount })}
            </p>
            {/* To its uploader and the Admins only (getCircle). */}
            {detail.iconStatus === "checking" && (
              <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                <Clock aria-hidden className="size-3.5" />
                {t("icon.checking")}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {detail.members.length > 0 && (
            <CircleAvatarStack
              circleName={detail.name}
              members={detail.members.map((member: CircleMemberView) => ({
                key: member.membershipId,
                name: seatName(member),
                avatar: member.avatar,
                fallback: <MemberInitial source={member} />,
              }))}
            />
          )}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {canManageCircle(detail.viewerPermission) && user && (
              <Button
                variant="outline"
                size="sm"
                className="h-11 md:h-8"
                onClick={() => setManageOpen(true)}
                aria-label={t("page.manageNamed", { circle: detail.name })}
              >
                <Settings aria-hidden className="size-4" />
                {t("page.manage")}
              </Button>
            )}
            {!detail.isOwnedByViewer && (
              <LeaveCircleAction
                circleId={circleId}
                circleName={detail.name}
                onLeft={backToList}
              />
            )}
          </div>
        </div>
      </Card>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ChatPreview circleId={circleId} circleName={detail.name} />
        <SharedPuzzles
          circleId={circleId}
          canShare={canShareInCircle(detail.viewerPermission)}
        />
      </div>

      {manageOpen && user && (
        <ManageCircleDialog
          circleId={circleId}
          viewerId={user.id}
          onClose={() => setManageOpen(false)}
          onDeleted={backToList}
        />
      )}
    </div>
  );
}

function Section({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 sm:p-6">
      <h3 className="font-heading text-lg font-semibold">{title}</h3>
      {children}
      {footer}
    </Card>
  );
}

// The newest few messages, through the same thread read as the chat itself
// (getThreadMessages: the joinedAt floor, current seats, block flags), so a
// blocked member's message is only its placeholder text here. Viewing never
// creates the thread: getCircleThreadId is null until someone opens the chat.
function ChatPreview({
  circleId,
  circleName,
}: {
  circleId: string;
  circleName: string;
}) {
  const t = useTranslations("circles");
  const tMessages = useTranslations("messages");
  const tSafety = useTranslations("safety");
  const locale = useLocale();
  const now = useNow({ updateInterval: 60_000 }).getTime();
  const displayName = useMemberDisplayName();
  const { member } = useCurrentMember();
  const me = member?._id;

  const thread = useQuery(
    convexQuery(gateway.conversation.getCircleThreadId, { circleId }),
  );
  const threadId = thread.data ?? null;
  const messages = useQuery(
    convexQuery(
      gateway.conversation.getThreadMessages,
      threadId ? { threadId, limit: CHAT_PREVIEW_SIZE } : "skip",
    ),
  );

  let body: ReactNode;
  if (thread.isError || messages.isError) {
    body = (
      <p className="text-muted-foreground text-sm">{t("page.chatError")}</p>
    );
  } else if (thread.isPending || (threadId !== null && messages.isPending)) {
    body = <Skeleton className="h-24 w-full" />;
  } else if (threadId === null || !messages.data?.length) {
    body = (
      <p className="text-muted-foreground text-sm">{t("page.chatEmpty")}</p>
    );
  } else {
    body = (
      <ul className="flex flex-col divide-y">
        {messages.data.map((message) => (
          <li
            key={message.id}
            className={
              message.kind === "system"
                ? "text-muted-foreground py-2 text-center text-xs"
                : "flex min-w-0 items-baseline gap-3 py-2 text-sm"
            }
          >
            {message.kind === "system" ? (
              message.systemEvent ? (
                systemEventText(message.systemEvent, me, tMessages, displayName)
              ) : (
                message.body
              )
            ) : (
              <>
                <span
                  className={
                    message.authorBlockedByMe
                      ? "text-muted-foreground min-w-0 flex-1 truncate italic"
                      : "min-w-0 flex-1 truncate"
                  }
                >
                  {circleSnippet(
                    message,
                    me,
                    tMessages,
                    displayName,
                    tSafety("messageRemoved"),
                  )}
                </span>
                <time
                  dateTime={new Date(message.sentAt).toISOString()}
                  title={formatFullDateTime(message.sentAt, locale)}
                  className="text-muted-foreground shrink-0 text-xs tabular-nums"
                >
                  {formatCompactTime(message.sentAt, now, locale, tMessages)}
                </time>
              </>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Section
      title={t("page.chatTitle")}
      footer={
        <OpenCircleChatButton
          circleId={circleId}
          circleName={circleName}
          variant="brand"
          className="w-full sm:w-auto sm:self-start"
        />
      }
    >
      {body}
    </Section>
  );
}

// The circle's shared copies (members only, canViewCopy per copy, private
// copies left out), each linking to its copy page.
function SharedPuzzles({
  circleId,
  canShare,
}: {
  circleId: string;
  // Exchange and Admin may share their own copies here (read live from viewerPermission).
  canShare: boolean;
}) {
  const t = useTranslations("circles");
  const { member } = useCurrentMember();
  const {
    data: copies,
    isPending,
    isError,
  } = useQuery(convexQuery(gateway.sharing.circleSharedCopies, { circleId }));

  let body: ReactNode;
  if (isError) {
    body = (
      <p className="text-muted-foreground text-sm">{t("page.sharedError")}</p>
    );
  } else if (isPending || copies === undefined) {
    body = <Skeleton className="h-24 w-full" />;
  } else if (copies.length === 0) {
    body = (
      <p className="text-muted-foreground text-sm">{t("page.sharedEmpty")}</p>
    );
  } else {
    body = (
      <ul className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        {copies.map((copy) => (
          <li key={copy.copyId} className="min-w-0">
            <MessageCopyCard copy={copy} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Section
      title={t("page.sharedTitle")}
      footer={
        canShare && (
          <div className="mt-1 border-t pt-4">
            <CircleShareSection circleId={circleId} memberId={member?._id} />
          </div>
        )
      }
    >
      {body}
    </Section>
  );
}

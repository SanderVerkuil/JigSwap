import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { canManageCircle } from "@/components/circles/circle-admin-sections";
import { CircleAvatarStack } from "@/components/circles/circle-avatar-stack";
import { MyCircleInvitations } from "@/components/circles/circle-invitations";
import {
  isInvalidCircleName,
  MAX_CIRCLE_NAME_LENGTH,
} from "@/components/circles/circle-name";
import {
  useCircleSeatName,
  type CircleMemberView,
  type CirclePermissionLevel,
} from "@/components/circles/circle-seat";
import { LeaveCircleAction } from "@/components/circles/leave-circle-action";
import { ManageCircleDialog } from "@/components/circles/manage-circle-dialog";
import {
  CoverChip,
  EmptyState,
  MiniStat,
} from "@/components/community/primitives";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { MemberInitial } from "@/components/members/member-initial";
import { circleHref } from "@/components/messaging/format";
import { OpenCircleChatButton } from "@/components/messaging/open-circle-chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway } from "@/gateway";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Settings, Users } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

// Mirrors the Sharing contract DTOs; declared locally so the web app (type:app) reaches Convex only
// via the gateway and never depends on @jigswap/contracts directly.
interface CircleSummaryView {
  _id: string;
  aggregateId?: string;
  name: string;
  memberCount: number;
  isOwnedByViewer: boolean;
  viewerPermission: CirclePermissionLevel;
  createdAt: number;
}

export const Route = createFileRoute("/_dashboard/circles/")({
  // `invite` is the circle_invite_received deep link: highlight that invitation.
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "circles") }],
  }),
  pendingComponent: () => <CirclesPending />,
  component: CirclesPage,
});

function CirclesPending() {
  const t = useTranslations("circles");
  return <PageLoading message={t("loading")} />;
}

function CirclesPage() {
  const { user } = useUser();
  const t = useTranslations("circles");
  const { invite: highlightInviteId } = Route.useSearch();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameInvalid, setNameInvalid] = useState(false);
  const [manageCircleId, setManageCircleId] = useState<string | null>(null);

  const { data: circles, isPending: circlesPending } = useQuery(
    convexQuery(gateway.sharing.myCircles, {}),
  );
  const createCircle = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.createCircle),
  });

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await createCircle.mutateAsync({ name: name.trim() });
      setName("");
      setIsCreateOpen(false);
    } catch (error) {
      if (isInvalidCircleName(error)) setNameInvalid(true);
      else console.error("Failed to create circle:", error);
    }
  };

  // The page title lives in the shell page head; publish the meta + primary
  // action there too so the body carries no duplicate section header.
  usePageHeaderActions(
    () => (
      <>
        <span className="text-muted-foreground hidden text-sm sm:inline">
          {t("meta")}
        </span>
        <Button variant="brand" size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("createCircle")}
        </Button>
      </>
    ),
    [t],
  );

  if (!user || circlesPending || circles === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="flex flex-col">
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("manage.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("manage.createDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="circle-name">{t("manage.nameLabel")}</Label>
              <Input
                id="circle-name"
                value={name}
                maxLength={MAX_CIRCLE_NAME_LENGTH}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameInvalid(false);
                }}
                placeholder={t("manage.namePlaceholder")}
                aria-describedby="circle-name-counter"
                aria-invalid={nameInvalid || undefined}
              />
              <p
                id="circle-name-counter"
                className="text-muted-foreground mt-1 text-right text-xs"
              >
                {t("manage.nameCounter", {
                  count: name.length,
                  max: MAX_CIRCLE_NAME_LENGTH,
                })}
              </p>
              {nameInvalid && (
                <p role="alert" className="text-destructive text-sm">
                  {t("manage.nameInvalid")}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              {t("manage.cancel")}
            </Button>
            <Button onClick={handleCreate}>{t("manage.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MyCircleInvitations highlightInviteId={highlightInviteId} />

      {circles.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          sub={t("emptySub")}
          action={
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("createCircle")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {circles.map((circle: CircleSummaryView, index: number) => (
            <CircleRow
              key={circle._id}
              circle={circle}
              gradientIndex={index}
              onManage={
                canManageCircle(circle.viewerPermission) && circle.aggregateId
                  ? () => setManageCircleId(circle.aggregateId!)
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {manageCircleId && (
        <ManageCircleDialog
          circleId={manageCircleId}
          viewerId={user.id}
          onClose={() => setManageCircleId(null)}
        />
      )}
    </div>
  );
}

// One circle as a full-width row tile. The identity half (gradient icon chip,
// heading-font name with the viewer's role badge, a one-line blurb) links to
// the circle's page; the member avatar stack, the members stat and the actions
// sit beside it from xl up and wrap onto their own line below that, so the
// name always keeps the room it needs.
function CircleRow({
  circle,
  gradientIndex,
  onManage,
}: {
  circle: CircleSummaryView;
  gradientIndex: number;
  onManage?: () => void;
}) {
  const t = useTranslations("circles");
  const identity = (
    <>
      <CoverChip icon={Users} size={52} gradientIndex={gradientIndex} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="font-heading min-w-0 truncate text-lg font-bold">
            {circle.name}
          </span>
          <Badge variant="secondary" className="shrink-0">
            {circle.isOwnedByViewer ? t("roleOwner") : t("roleMember")}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-0.5 truncate text-sm">
          {circle.isOwnedByViewer ? t("ownedByYou") : t("sharedWithYou")}
        </p>
      </div>
    </>
  );

  return (
    <Card className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:gap-4">
      {circle.aggregateId ? (
        <Link
          href={circleHref(circle.aggregateId)}
          className="hover:bg-accent/50 focus-visible:ring-ring -m-2 flex min-w-0 flex-1 items-center gap-4 rounded-lg p-2 transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none"
        >
          {identity}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-4">{identity}</div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {circle.aggregateId && (
          <CircleMembersStack
            circleId={circle.aggregateId}
            circleName={circle.name}
          />
        )}
        <MiniStat
          value={circle.memberCount}
          label={t("membersLabel", { count: circle.memberCount })}
        />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {circle.aggregateId && (
            <OpenCircleChatButton
              circleId={circle.aggregateId}
              circleName={circle.name}
            />
          )}
          {onManage && (
            <Button
              variant="ghost"
              size="sm"
              className="size-11 md:size-8"
              onClick={onManage}
              aria-label={t("page.manageNamed", { circle: circle.name })}
            >
              <Settings className="h-4 w-4" />
            </Button>
          )}
          {!circle.isOwnedByViewer && circle.aggregateId && (
            <LeaveCircleAction
              circleId={circle.aggregateId}
              circleName={circle.name}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

// The circle's member avatar stack. The members come from the (member-gated)
// circle detail read; while it loads we hold the space with a skeleton so
// rows don't jump.
function CircleMembersStack({
  circleId,
  circleName,
}: {
  circleId: string;
  circleName: string;
}) {
  const seatName = useCircleSeatName();
  const { data: detail, isPending } = useQuery(
    convexQuery(gateway.sharing.circle, { circleId }),
  );

  if (isPending || detail === undefined) {
    return <Skeleton className="h-8 w-20 rounded-full" />;
  }
  if (!detail || detail.members.length === 0) {
    return null;
  }

  return (
    <div className="flex">
      <CircleAvatarStack
        circleName={circleName}
        members={detail.members.map((member: CircleMemberView) => ({
          key: member.membershipId,
          name: seatName(member),
          avatar: member.avatar,
          fallback: <MemberInitial source={member} />,
        }))}
      />
    </div>
  );
}

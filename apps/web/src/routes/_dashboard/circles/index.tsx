import { useUser } from "@/compat/clerk";
import { Link } from "@/compat/link";
import { canManageCircle } from "@/components/circles/circle-admin-sections";
import { CircleAvatarStack } from "@/components/circles/circle-avatar-stack";
import { MyCircleInvitations } from "@/components/circles/circle-invitations";
import {
  isInvalidCircleName,
  MAX_CIRCLE_NAME_LENGTH,
} from "@/components/circles/circle-name";
import { CircleRoleBadge } from "@/components/circles/circle-role-badge";
import {
  useCircleSeatName,
  type CircleMemberView,
  type CirclePermissionLevel,
} from "@/components/circles/circle-seat";
import { LeaveCircleAction } from "@/components/circles/leave-circle-action";
import { ManageCircleDialog } from "@/components/circles/manage-circle-dialog";
import { CoverChip, EmptyState } from "@/components/community/primitives";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { MemberInitial } from "@/components/members/member-initial";
import { CircleThreadAvatar } from "@/components/messaging/circle-thread-avatar";
import { circleHref } from "@/components/messaging/format";
import { OpenCircleChatButton } from "@/components/messaging/open-circle-chat";
import { GuideHelpButton } from "@/components/tour/guide-help-button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoading } from "@/components/ui/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { useTourLauncher } from "@/components/whats-new/tour-launcher";
import { gateway } from "@/gateway";
import { validateCirclesSearch } from "@/lib/circles-search";
import { convexErrorCode } from "@/lib/convex-error-code";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  LogOut,
  MoreHorizontal,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
  iconUrl?: string;
}

export const Route = createFileRoute("/_dashboard/circles/")({
  // `invite` highlights an invitation; `create` opens the create dialog (see circles-search.ts).
  validateSearch: validateCirclesSearch,
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
  const { invite: highlightInviteId, create: createRequested } =
    Route.useSearch();
  const navigate = useNavigate();
  const [createOpenedHere, setCreateOpenedHere] = useState(false);
  // Open when opened from this page, or when arriving via ?create=1 (the ⌘K quick action). The
  // flag lives in the URL, so closing drops it (replace: Back must not reopen the dialog).
  const isCreateOpen = createOpenedHere || createRequested === true;
  const setIsCreateOpen = (open: boolean) => {
    setCreateOpenedHere(open);
    if (!open && createRequested) {
      void navigate({
        to: "/circles",
        search: { invite: highlightInviteId },
        replace: true,
      });
    }
  };
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
      else if (convexErrorCode(error) === "RateLimited") {
        toast.error(t("manage.createRateLimited"));
      } else console.error("Failed to create circle:", error);
    }
  };

  // The page title and subtitle live in the shell page head; publish the guide
  // and primary action there too so the body carries no duplicate section header.
  const { startTour } = useTourLauncher();
  usePageHeaderActions(
    () => (
      <>
        <GuideHelpButton tourId="circles" startTour={startTour} />
        <Button
          variant="brand"
          size="sm"
          onClick={() => setIsCreateOpen(true)}
          data-tour="circles-create"
        >
          <Plus className="h-4 w-4" />
          {t("createCircle")}
        </Button>
      </>
    ),
    [t, startTour],
  );

  if (!user || circlesPending || circles === undefined) {
    return <PageLoading message={t("loading")} />;
  }

  return (
    <div className="flex flex-col" data-tour="circles-list">
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
              <Label htmlFor="circle-name" className="mb-2">
                {t("manage.nameLabel")}
              </Label>
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

// One circle as a full-width row tile. The identity half (the circle's icon,
// else a gradient icon chip, the heading-font name over the viewer's seat
// badge — Owner or their permission) links to the circle's page, with a
// chevron so touch users (no hover) can tell. The name has its line to itself,
// so a long name keeps its room on a phone. The member avatar
// stack and the actions sit beside it from xl up and wrap onto their own
// left-aligned line below that, so the name always keeps the room it needs.
// Leave is destructive and rare, so it sits behind a ⋯ menu rather than
// beside the group chat button.
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
      {circle.iconUrl ? (
        <CircleThreadAvatar
          members={[]}
          iconUrl={circle.iconUrl}
          className="size-[52px]"
        />
      ) : (
        <CoverChip icon={Users} size={52} gradientIndex={gradientIndex} />
      )}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="font-heading max-w-full truncate text-lg font-bold">
          {circle.name}
        </span>
        <CircleRoleBadge
          isOwner={circle.isOwnedByViewer}
          permission={circle.viewerPermission}
        />
      </div>
    </>
  );

  // A legacy circle without an id has no page, chat or actions.
  if (!circle.aggregateId) {
    return (
      <Card className="flex items-center gap-4 p-4">
        <div className="flex min-w-0 flex-1 items-center gap-4">{identity}</div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:gap-4">
      <Link
        href={circleHref(circle.aggregateId)}
        className="hover:bg-accent/50 focus-visible:ring-ring -m-2 flex min-w-0 flex-1 items-center gap-4 rounded-lg p-2 transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none"
      >
        {identity}
        <ChevronRight
          aria-hidden
          className="text-muted-foreground size-5 shrink-0"
        />
      </Link>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <CircleMembersStack
          circleId={circle.aggregateId}
          circleName={circle.name}
        />
        <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
          <OpenCircleChatButton
            circleId={circle.aggregateId}
            circleName={circle.name}
          />
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
          {!circle.isOwnedByViewer && (
            <CircleRowMenu
              circleId={circle.aggregateId}
              circleName={circle.name}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

// A member's ⋯ menu on a circle row: Leave circle, behind its confirm. Focus
// returns to the ⋯ trigger when the confirm is cancelled.
function CircleRowMenu({
  circleId,
  circleName,
}: {
  circleId: string;
  circleName: string;
}) {
  const t = useTranslations("circles");
  const [leaving, setLeaving] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            className="size-11 md:size-8"
            aria-label={t("rowMenuLabel", { circle: circleName })}
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            className="min-h-11 md:min-h-0"
            onSelect={() => setLeaving(true)}
          >
            <LogOut aria-hidden />
            {t("leave")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LeaveCircleAction
        circleId={circleId}
        circleName={circleName}
        open={leaving}
        onOpenChange={setLeaving}
        returnFocusRef={triggerRef}
      />
    </>
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

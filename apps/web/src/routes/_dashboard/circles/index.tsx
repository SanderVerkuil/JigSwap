import { useUser } from "@/compat/clerk";
import {
  canManageCircle,
  CircleDeleteSection,
  CircleInviteSection,
  memberRowControls,
} from "@/components/circles/circle-admin-sections";
import { CircleAvatarStack } from "@/components/circles/circle-avatar-stack";
import { MyCircleInvitations } from "@/components/circles/circle-invitations";
import {
  isInvalidCircleName,
  MAX_CIRCLE_NAME_LENGTH,
} from "@/components/circles/circle-name";
import { LeaveCircleAction } from "@/components/circles/leave-circle-action";
import {
  CoverChip,
  EmptyState,
  MiniStat,
} from "@/components/community/primitives";
import { usePageHeaderActions } from "@/components/dashboard-layout/page-header-slot";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useProjectedMemberName } from "@/lib/member-display-name";
import { pageTitle } from "@/lib/page-title";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Settings, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";

// Mirrors the Sharing contract DTOs; declared locally so the web app (type:app) reaches Convex only
// via the gateway and never depends on @jigswap/contracts directly.
type CirclePermissionLevel = "ViewOnly" | "Exchange" | "Admin";

interface CircleSummaryView {
  _id: string;
  aggregateId?: string;
  ownerId: string;
  name: string;
  memberCount: number;
  isOwnedByViewer: boolean;
  viewerPermission: CirclePermissionLevel;
  createdAt: number;
}

interface CircleMemberView {
  membershipId: string;
  memberId: string;
  name?: string;
  username?: string;
  avatar?: string;
  // The account is gone or deactivated: no name/username/avatar; render "Former member".
  departed?: boolean;
  permission: CirclePermissionLevel;
  joinedAt: number;
  isOwner: boolean;
}

// A circle seat's label: the member's display name, or "Former member" for a departed account (the
// server omits its identity). The seat itself stays manageable (an admin can still remove it).
function useCircleSeatName() {
  const projectedName = useProjectedMemberName();
  return (member: CircleMemberView) =>
    projectedName(
      member.departed
        ? { anonymous: true, departed: true }
        : { anonymous: false, member },
      "",
    );
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

const PERMISSIONS: CirclePermissionLevel[] = ["ViewOnly", "Exchange", "Admin"];

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

// One circle as a full-width row tile: gradient icon chip, heading-font name
// with the viewer's role badge, a one-line blurb, then the overlapping member
// avatar stack and a big-number members stat on the right.
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

  return (
    <Card className="flex flex-row items-center gap-4 p-4">
      <CoverChip icon={Users} size={52} gradientIndex={gradientIndex} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="font-heading truncate text-lg font-bold">
            {circle.name}
          </span>
          <Badge variant="secondary">
            {circle.isOwnedByViewer ? t("roleOwner") : t("roleMember")}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-0.5 truncate text-sm">
          {circle.isOwnedByViewer ? t("ownedByYou") : t("sharedWithYou")}
        </p>
      </div>
      <div className="flex items-center gap-5">
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
        {onManage && (
          <Button variant="ghost" size="sm" onClick={onManage}>
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
    return <Skeleton className="hidden h-8 w-20 rounded-full sm:block" />;
  }
  if (!detail || detail.members.length === 0) {
    return null;
  }

  return (
    <div className="hidden sm:flex">
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

function ManageCircleDialog({
  circleId,
  viewerId,
  onClose,
}: {
  circleId: string;
  viewerId: string;
  onClose: () => void;
}) {
  const t = useTranslations("circles");
  const seatName = useCircleSeatName();
  const { data: detail, isPending: detailPending } = useQuery(
    convexQuery(gateway.sharing.circle, { circleId }),
  );
  const { data: convexUser } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      viewerId ? { clerkId: viewerId } : "skip",
    ),
  );

  const [shareCopyId, setShareCopyId] = useState<string>("");

  const { data: myCopies } = useQuery(
    convexQuery(
      gateway.library.ownedByOwner,
      convexUser?._id
        ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: true }
        : "skip",
    ),
  );

  const removeMember = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.removeMember),
  });
  const changePermission = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.changePermission),
  });
  const shareCopy = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.shareCopyToCircle),
  });

  const handleRemove = async (member: CircleMemberView) => {
    try {
      await removeMember.mutateAsync({
        circleId,
        memberId: member.memberId as Id<"users">,
      });
    } catch (error) {
      console.error("Failed to remove member:", error);
    }
  };

  const handlePermission = async (
    member: CircleMemberView,
    permission: CirclePermissionLevel,
  ) => {
    try {
      await changePermission.mutateAsync({
        circleId,
        memberId: member.memberId as Id<"users">,
        permission,
      });
    } catch (error) {
      console.error("Failed to change permission:", error);
    }
  };

  const handleShare = async () => {
    if (!shareCopyId) return;
    try {
      await shareCopy.mutateAsync({ circleId, copyId: shareCopyId });
      setShareCopyId("");
    } catch (error) {
      console.error("Failed to share copy:", error);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Scrolls when the invite picker and pending list make it taller than a phone screen. */}
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("manage.title", {
              name: detail?.name ?? t("manage.fallbackName"),
            })}
          </DialogTitle>
          <DialogDescription>{t("manage.description")}</DialogDescription>
        </DialogHeader>

        {detailPending || detail === undefined ? (
          <PageLoading message={t("manage.loadingCircle")} />
        ) : detail === null ? (
          <p className="text-sm text-muted-foreground">
            {t("manage.unavailable")}
          </p>
        ) : (
          <div className="space-y-6">
            {/* Members */}
            <section className="space-y-3">
              <h3 className="font-medium">{t("manage.members")}</h3>
              {detail.members.map((member: CircleMemberView) => (
                <div
                  key={member.membershipId}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.avatar} />
                      <AvatarFallback>
                        <MemberInitial source={member} />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{seatName(member)}</p>
                      {member.isOwner && (
                        <Badge variant="outline" className="text-xs">
                          {t("manage.owner")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={member.permission}
                      disabled={
                        !memberRowControls(
                          detail.viewerPermission,
                          member,
                          convexUser?._id,
                        ).canChangePermission
                      }
                      onValueChange={(value: CirclePermissionLevel) =>
                        handlePermission(member, value)
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERMISSIONS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {t(`permissions.${p}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {memberRowControls(
                      detail.viewerPermission,
                      member,
                      convexUser?._id,
                    ).canRemove && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(member)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </section>

            <CircleInviteSection
              circleId={circleId}
              viewerPermission={detail.viewerPermission}
            />

            {/* Share a copy — surface the friend-circle VisibilityScope */}
            {/* Admin only, read live: a viewer who loses Admin loses it at once */}
            {canManageCircle(detail.viewerPermission) && (
              <section className="space-y-3">
                <h3 className="font-medium">{t("manage.shareCopy")}</h3>
                <p className="text-xs text-muted-foreground">
                  {t.rich("manage.shareDescription", {
                    scope: (chunks) => (
                      <span className="font-medium">{chunks}</span>
                    ),
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <Select value={shareCopyId} onValueChange={setShareCopyId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={t("manage.chooseCopy")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(myCopies ?? [])
                        .filter((copy) => copy.aggregateId)
                        .map((copy) => (
                          <SelectItem
                            key={copy._id}
                            value={copy.aggregateId as string}
                          >
                            {copy.puzzle?.title ??
                              copy.snapshot?.title ??
                              t("manage.copyFallback")}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={handleShare} disabled={!shareCopyId}>
                    {t("manage.share")}
                  </Button>
                </div>
              </section>
            )}

            <CircleDeleteSection
              circleId={circleId}
              circleName={detail.name}
              isOwnedByViewer={detail.isOwnedByViewer}
              onDeleted={onClose}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("manage.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

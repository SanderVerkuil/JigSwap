import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { useUser } from "@/compat/clerk";
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
  DialogTrigger,
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
import {
  CoverChip,
  EmptyState,
  MiniStat,
} from "@/components/community/primitives";
import { SectionHead } from "@/components/dashboard-home/section-head";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
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
  createdAt: number;
}

interface CircleMemberView {
  membershipId: string;
  memberId: string;
  name: string;
  username?: string;
  avatar?: string;
  permission: CirclePermissionLevel;
  joinedAt: number;
  isOwner: boolean;
}

export const Route = createFileRoute("/_dashboard/circles/")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "circles") }],
  }),
  pendingComponent: () => <PageLoading message="Loading circles..." />,
  component: CirclesPage,
});

const PERMISSIONS: CirclePermissionLevel[] = ["ViewOnly", "Exchange", "Admin"];

function CirclesPage() {
  const { user } = useUser();
  const t = useTranslations("circles");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [manageCircleId, setManageCircleId] = useState<string | null>(null);

  const circles = useQuery(gateway.sharing.myCircles, {});
  const createCircle = useMutation(gateway.sharing.createCircle);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await createCircle({ name: name.trim() });
      setName("");
      setIsCreateOpen(false);
    } catch (error) {
      console.error("Failed to create circle:", error);
    }
  };

  if (!user || circles === undefined) {
    return <PageLoading message="Loading circles..." />;
  }

  return (
    <div className="flex flex-col">
      <SectionHead
        title={t("yourCircles")}
        icon={Users}
        meta={t("meta")}
        action={
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                {t("createCircle")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Circle</DialogTitle>
                <DialogDescription>
                  A circle is private. You become its first member and admin.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="circle-name">Name</Label>
                  <Input
                    id="circle-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Saturday Puzzlers"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreate}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

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
                circle.isOwnedByViewer && circle.aggregateId
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
          <CircleAvatarStack circleId={circle.aggregateId} />
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
      </div>
    </Card>
  );
}

// The overlapping avatar stack of up to four circle members. The members come
// from the (member-gated) circle detail read; while it loads we hold the space
// with a skeleton so rows don't jump.
function CircleAvatarStack({ circleId }: { circleId: string }) {
  const detail = useQuery(gateway.sharing.circle, { circleId });

  if (detail === undefined) {
    return <Skeleton className="hidden h-8 w-20 rounded-full sm:block" />;
  }
  if (!detail || detail.members.length === 0) {
    return null;
  }

  return (
    <div className="hidden sm:flex">
      {detail.members.slice(0, 4).map((member: CircleMemberView, i) => (
        <Avatar
          key={member.membershipId}
          className="ring-card size-8 ring-2 first:ml-0"
          style={{ marginLeft: i === 0 ? 0 : -10 }}
        >
          {member.avatar && (
            <AvatarImage src={member.avatar} alt={member.name} />
          )}
          <AvatarFallback className="text-xs">
            {member.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
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
  const detail = useQuery(gateway.sharing.circle, { circleId });
  const convexUser = useQuery(
    gateway.identity.byClerkId,
    viewerId ? { clerkId: viewerId } : "skip",
  );

  const [search, setSearch] = useState("");
  const [addPermission, setAddPermission] =
    useState<CirclePermissionLevel>("ViewOnly");
  const [shareCopyId, setShareCopyId] = useState<string>("");

  const searchResults = useQuery(
    gateway.identity.search,
    search.trim().length >= 2 ? { searchTerm: search.trim() } : "skip",
  );
  const myCopies = useQuery(
    gateway.library.ownedByOwner,
    convexUser?._id
      ? { ownerId: convexUser._id as Id<"users">, includeUnavailable: true }
      : "skip",
  );

  const addMember = useMutation(gateway.sharing.addMember);
  const removeMember = useMutation(gateway.sharing.removeMember);
  const changePermission = useMutation(gateway.sharing.changePermission);
  const shareCopy = useMutation(gateway.sharing.shareCopyToCircle);

  const handleAdd = async (memberId: string) => {
    try {
      await addMember({
        circleId,
        memberId: memberId as Id<"users">,
        permission: addPermission,
      });
      setSearch("");
    } catch (error) {
      console.error("Failed to add member:", error);
    }
  };

  const handleRemove = async (member: CircleMemberView) => {
    try {
      await removeMember({
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
      await changePermission({
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
      await shareCopy({ circleId, copyId: shareCopyId });
      setShareCopyId("");
    } catch (error) {
      console.error("Failed to share copy:", error);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage {detail?.name ?? "circle"}</DialogTitle>
          <DialogDescription>
            Add or remove members, set permissions, and share copies.
          </DialogDescription>
        </DialogHeader>

        {detail === undefined ? (
          <PageLoading message="Loading circle..." />
        ) : detail === null ? (
          <p className="text-sm text-muted-foreground">
            This circle is no longer available.
          </p>
        ) : (
          <div className="space-y-6">
            {/* Members */}
            <section className="space-y-3">
              <h3 className="font-medium">Members</h3>
              {detail.members.map((member: CircleMemberView) => (
                <div
                  key={member.membershipId}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.avatar} />
                      <AvatarFallback>
                        {member.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">{member.name}</p>
                      {member.isOwner && (
                        <Badge variant="outline" className="text-xs">
                          Owner
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={member.permission}
                      disabled={member.isOwner}
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
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!member.isOwner && (
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

            {/* Add member */}
            <section className="space-y-3">
              <h3 className="font-medium">Add member</h3>
              <div className="flex items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search members by name…"
                />
                <Select
                  value={addPermission}
                  onValueChange={(value: CirclePermissionLevel) =>
                    setAddPermission(value)
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERMISSIONS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {searchResults && searchResults.length > 0 && (
                <div className="space-y-1">
                  {searchResults.map((result) => (
                    <div
                      key={result._id}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm">{result.name}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAdd(result._id)}
                      >
                        Add
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Share a copy — surface the friend-circle VisibilityScope */}
            <section className="space-y-3">
              <h3 className="font-medium">Share a copy</h3>
              <p className="text-xs text-muted-foreground">
                Shared copies become visible to circle members at the
                <span className="font-medium"> friendCircle</span> visibility
                scope, even if otherwise private.
              </p>
              <div className="flex items-center gap-2">
                <Select value={shareCopyId} onValueChange={setShareCopyId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Choose one of your copies…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(myCopies ?? [])
                      .filter((copy) => copy.aggregateId)
                      .map((copy) => (
                        <SelectItem
                          key={copy._id}
                          value={copy.aggregateId as string}
                        >
                          {copy.puzzle?.title ?? copy.snapshot?.title ?? "Copy"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleShare} disabled={!shareCopyId}>
                  Share
                </Button>
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

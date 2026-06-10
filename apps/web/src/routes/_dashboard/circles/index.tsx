import { createFileRoute } from "@tanstack/react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useUser } from "@/compat/clerk";
import { gateway, Id } from "@/gateway";
import { useMutation, useQuery } from "convex/react";
import { Plus, Settings, Trash2, Users } from "lucide-react";
import { useState } from "react";

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
  pendingComponent: () => <PageLoading message="Loading circles..." />,
  component: CirclesPage,
});

const PERMISSIONS: CirclePermissionLevel[] = ["ViewOnly", "Exchange", "Admin"];

function CirclesPage() {
  const { user } = useUser();
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
    <div className="container mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Friend Circles</h1>
          <p className="text-muted-foreground">
            Private groups you share puzzles with.
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Circle
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
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {circles.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="text-muted-foreground mb-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <Users className="h-8 w-8" />
              </div>
              <h3 className="text-lg font-medium mb-2">No circles yet</h3>
              <p className="text-sm">
                Create a circle to share copies with friends.
              </p>
            </div>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Circle
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {circles.map((circle: CircleSummaryView) => (
            <Card key={circle._id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded flex items-center justify-center bg-muted">
                      <Users className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-lg">{circle.name}</CardTitle>
                  </div>
                  {circle.isOwnedByViewer && circle.aggregateId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setManageCircleId(circle.aggregateId!)}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <CardDescription>
                  {circle.isOwnedByViewer ? "Owned by you" : "Shared with you"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="secondary">
                  {circle.memberCount} member
                  {circle.memberCount === 1 ? "" : "s"}
                </Badge>
              </CardContent>
            </Card>
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

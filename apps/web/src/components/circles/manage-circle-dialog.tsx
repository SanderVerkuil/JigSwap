import {
  canManageCircle,
  canShareInCircle,
  CircleDeleteSection,
  CircleInviteSection,
  memberRowControls,
} from "@/components/circles/circle-admin-sections";
import { CircleIconSection } from "@/components/circles/circle-icon";
import {
  useCircleSeatName,
  type CircleMemberView,
  type CirclePermissionLevel,
} from "@/components/circles/circle-seat";
import { CircleShareSection } from "@/components/circles/circle-share-section";
import { MemberInitial } from "@/components/members/member-initial";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageLoading } from "@/components/ui/loading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gateway } from "@/gateway";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { useTranslations } from "use-intl";

const PERMISSIONS: CirclePermissionLevel[] = ["ViewOnly", "Exchange", "Admin"];

export function ManageCircleDialog({
  circleId,
  viewerId,
  focusInvite = false,
  onClose,
  onDeleted = onClose,
}: {
  circleId: string;
  viewerId: string;
  // Open at the invite section (the page's "Invite people"), not at the top of the dialog.
  focusInvite?: boolean;
  onClose: () => void;
  // After the owner deletes the circle; closing the dialog by default.
  onDeleted?: () => void;
}) {
  const t = useTranslations("circles");
  const seatName = useCircleSeatName();
  const inviteSection = useRef<HTMLElement>(null);
  const { data: detail, isPending: detailPending } = useQuery(
    convexQuery(gateway.sharing.circle, { circleId }),
  );
  const { data: convexUser } = useQuery(
    convexQuery(
      gateway.identity.byClerkId,
      viewerId ? { clerkId: viewerId } : "skip",
    ),
  );

  const removeMember = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.removeMember),
  });
  const changePermission = useMutation({
    mutationFn: useConvexMutation(gateway.sharing.changePermission),
  });

  const handleRemove = async (member: CircleMemberView) => {
    try {
      await removeMember.mutateAsync({
        circleId,
        membershipId: member.membershipId,
      });
    } catch (error) {
      console.error("Failed to remove member:", error);
      toast.error(t("manage.removeFailed", { name: seatName(member) }));
    }
  };

  const handlePermission = async (
    member: CircleMemberView,
    permission: CirclePermissionLevel,
  ) => {
    try {
      await changePermission.mutateAsync({
        circleId,
        membershipId: member.membershipId,
        permission,
      });
    } catch (error) {
      console.error("Failed to change permission:", error);
      toast.error(t("manage.permissionFailed", { name: seatName(member) }));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Scrolls when the invite picker and pending list make it taller than a phone screen. */}
      <DialogContent
        className="max-h-[90dvh] max-w-2xl overflow-y-auto"
        // On the section, not its search box: that would pop up a phone's keyboard over the people
        // to invite. Focusing it scrolls it into view.
        onOpenAutoFocus={(event) => {
          if (!focusInvite || !inviteSection.current) return;
          event.preventDefault();
          inviteSection.current.focus();
        }}
      >
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
                          detail.isOwnedByViewer,
                        ).canChangePermission
                      }
                      onValueChange={(value: CirclePermissionLevel) =>
                        handlePermission(member, value)
                      }
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PERMISSIONS.map((p) => (
                          <SelectItem
                            key={p}
                            value={p}
                            description={t(`permissionDescriptions.${p}`)}
                          >
                            {t(`permissions.${p}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {memberRowControls(
                      detail.viewerPermission,
                      member,
                      convexUser?._id,
                      detail.isOwnedByViewer,
                    ).canRemove && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("manage.removeMember", {
                          name: seatName(member),
                        })}
                        onClick={() => handleRemove(member)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </section>

            {/* Admins only; the server checks it too */}
            {canManageCircle(detail.viewerPermission) && (
              <CircleIconSection
                circleId={circleId}
                iconUrl={detail.iconUrl}
                iconStatus={detail.iconStatus}
              />
            )}

            <CircleInviteSection
              ref={inviteSection}
              circleId={circleId}
              viewerPermission={detail.viewerPermission}
            />

            {/* Read live: a viewer who drops to View only loses it at once */}
            {canShareInCircle(detail.viewerPermission) && (
              <CircleShareSection
                circleId={circleId}
                circleName={detail.name}
                memberId={convexUser?._id}
              />
            )}

            <CircleDeleteSection
              circleId={circleId}
              circleName={detail.name}
              isOwnedByViewer={detail.isOwnedByViewer}
              onDeleted={onDeleted}
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

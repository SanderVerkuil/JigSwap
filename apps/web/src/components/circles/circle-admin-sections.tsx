// The manage-circle dialog's permission-gated sections, each shown only where the backend lets
// this viewer use it: any Admin may invite and see/revoke pending invites; only the owner may
// delete the circle.
import { CircleInvitePicker } from "@/components/circles/circle-invite-picker";
import { CirclePendingInvites } from "@/components/circles/circle-pending-invites";
import { DeleteCircleAction } from "@/components/circles/delete-circle-action";
import { useTranslations } from "use-intl";

type CirclePermissionLevel = "ViewOnly" | "Exchange" | "Admin";

// Whether the viewer gets the manage dialog at all: membership changes, invites and copy sharing
// are all Admin-only in the domain (the owner's seat is always Admin).
export const canManageCircle = (viewerPermission: CirclePermissionLevel) =>
  viewerPermission === "Admin";

// The controls on one member's row in the manage dialog. Read off the live viewerPermission, so a
// viewer who loses Admin while the dialog is open loses them at once. The owner's seat is never
// editable, and the viewer's own row has no remove: walking out is Leave (recorded as "left"), not
// a removal. Until the viewer's id is known, no row offers remove.
export const memberRowControls = (
  viewerPermission: CirclePermissionLevel,
  member: { memberId: string; isOwner: boolean },
  viewerId: string | undefined,
) => {
  const canEdit = canManageCircle(viewerPermission) && !member.isOwner;
  return {
    canChangePermission: canEdit,
    canRemove:
      canEdit && viewerId !== undefined && member.memberId !== viewerId,
  };
};

// Invite: members join only by accepting. Any Admin, not only the owner.
export function CircleInviteSection({
  circleId,
  viewerPermission,
}: {
  circleId: string;
  viewerPermission: CirclePermissionLevel;
}) {
  const t = useTranslations("circles");
  if (!canManageCircle(viewerPermission)) return null;
  return (
    <section className="space-y-3">
      <h3 className="font-medium">{t("invite.title")}</h3>
      <CircleInvitePicker circleId={circleId} />
      <CirclePendingInvites circleId={circleId} />
    </section>
  );
}

// Owner only: delete the whole circle, confirmed by its name.
export function CircleDeleteSection({
  circleId,
  circleName,
  isOwnedByViewer,
  onDeleted,
}: {
  circleId: string;
  circleName: string;
  isOwnedByViewer: boolean;
  onDeleted: () => void;
}) {
  if (!isOwnedByViewer) return null;
  return (
    <section className="border-t pt-4">
      <DeleteCircleAction
        circleId={circleId}
        circleName={circleName}
        onDeleted={onDeleted}
      />
    </section>
  );
}

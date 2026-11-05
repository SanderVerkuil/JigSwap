// The manage-circle dialog's permission-gated sections, each shown only where the backend lets
// this viewer use it: any Admin may invite and see/revoke pending invites; only the owner may
// delete the circle or change and remove other Admins.
import { CircleInvitePicker } from "@/components/circles/circle-invite-picker";
import { CirclePendingInvites } from "@/components/circles/circle-pending-invites";
import { DeleteCircleAction } from "@/components/circles/delete-circle-action";
import { useId, type Ref } from "react";
import { useTranslations } from "use-intl";

type CirclePermissionLevel = "ViewOnly" | "Exchange" | "Admin";

// Whether the viewer gets the manage dialog at all: membership changes and invites are Admin-only
// in the domain (the owner's seat is always Admin).
export const canManageCircle = (viewerPermission: CirclePermissionLevel) =>
  viewerPermission === "Admin";

// Whether the viewer may share their own copies into the circle: Exchange or Admin (the domain's
// Circle.shareCopy rule). ViewOnly may not.
export const canShareInCircle = (viewerPermission: CirclePermissionLevel) =>
  viewerPermission === "Exchange" || viewerPermission === "Admin";

// The controls on one member's row in the manage dialog. Read off the live viewerPermission, so a
// viewer who loses Admin while the dialog is open loses them at once. The owner's seat is never
// editable, and the viewer's own row has no remove: walking out is Leave (recorded as "left"), not
// a removal. Another Admin's row is the owner's to change or remove (the domain's Circle rule), so
// a non-owner Admin sees it locked; they may still change their own level (step down). Until the
// viewer's id is known, no row offers remove and no Admin row opens to a non-owner.
export const memberRowControls = (
  viewerPermission: CirclePermissionLevel,
  member: {
    memberId?: string;
    isOwner: boolean;
    permission: CirclePermissionLevel;
  },
  viewerId: string | undefined,
  isOwnedByViewer: boolean,
) => {
  const isSelf = viewerId !== undefined && member.memberId === viewerId;
  const ownerOnlySeat =
    member.permission === "Admin" && !isOwnedByViewer && !isSelf;
  const canEdit =
    canManageCircle(viewerPermission) && !member.isOwner && !ownerOnlySeat;
  return {
    canChangePermission: canEdit,
    canRemove: canEdit && viewerId !== undefined && !isSelf,
  };
};

// Invite: members join only by accepting. Any Admin, not only the owner.
export function CircleInviteSection({
  ref,
  circleId,
  viewerPermission,
}: {
  ref?: Ref<HTMLElement>;
  circleId: string;
  viewerPermission: CirclePermissionLevel;
}) {
  const t = useTranslations("circles");
  const headingId = useId();
  if (!canManageCircle(viewerPermission)) return null;
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="scroll-mt-4 space-y-3 outline-none"
    >
      <h3 id={headingId} className="font-medium">
        {t("invite.title")}
      </h3>
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

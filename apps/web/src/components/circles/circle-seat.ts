import { useProjectedMemberName } from "@/lib/member-display-name";
import { useTranslations } from "use-intl";

// Mirrors the Sharing contract DTOs; declared locally so the web app (type:app) reaches Convex only
// via the gateway and never depends on @jigswap/contracts directly.
export type CirclePermissionLevel = "ViewOnly" | "Exchange" | "Admin";

export interface CircleMemberView {
  membershipId: string;
  // Absent for a departed seat (its real id never reaches the client): manage seats by membershipId.
  memberId?: string;
  name?: string;
  username?: string;
  avatar?: string;
  // The account is gone or deactivated: no name/username/avatar; render "Deleted member".
  departed?: boolean;
  permission: CirclePermissionLevel;
  joinedAt: number;
  isOwner: boolean;
}

// A circle seat's label: the member's display name, or "Deleted member" for a departed account (the
// server omits its identity). The seat itself stays manageable (an admin can still remove it).
export function useCircleSeatName() {
  const projectedName = useProjectedMemberName();
  return (member: CircleMemberView) =>
    projectedName(
      member.departed
        ? { anonymous: true, departed: true }
        : { anonymous: false, member },
      "",
    );
}

// What a seat is in the circle, for anyone in it: "Owner", or its permission level.
export function useCircleSeatRole() {
  const t = useTranslations("circles");
  return (member: Pick<CircleMemberView, "isOwner" | "permission">) =>
    member.isOwner ? t("roleOwner") : t(`permissions.${member.permission}`);
}

// Who a member can ask for more rights: the owner, else another Admin, whose account still exists.
export const circleSeatToAsk = (
  members: readonly CircleMemberView[],
): CircleMemberView | undefined => {
  const reachable = members.filter((member) => !member.departed);
  return (
    reachable.find((member) => member.isOwner) ??
    reachable.find((member) => member.permission === "Admin")
  );
};

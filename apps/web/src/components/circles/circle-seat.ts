import { useProjectedMemberName } from "@/lib/member-display-name";

// Mirrors the Sharing contract DTOs; declared locally so the web app (type:app) reaches Convex only
// via the gateway and never depends on @jigswap/contracts directly.
export type CirclePermissionLevel = "ViewOnly" | "Exchange" | "Admin";

export interface CircleMemberView {
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

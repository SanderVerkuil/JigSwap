import type { OwnedCopyView } from "../library/views";

// Household read models (queries under `household/*`). Household members accepted each other, so
// they see each other's name/avatar; an invitee sees the inviter (who initiated contact), and the
// admin sees the members they invited.

export type HouseholdRole = "admin" | "member";
export type HouseholdCopyPermission = "manage" | "view";

/** A member shown on a household surface (never carries email or Clerk ids). */
export interface HouseholdPersonView {
  memberId: string;
  /** Resolved display name (never the email); absent when the member has none — render the generic label. */
  name?: string;
  avatar?: string;
}

export interface HouseholdMemberView extends HouseholdPersonView {
  role: HouseholdRole;
  joinedAt: number;
  isYou: boolean;
}

/** A pending invite the household has sent (visible to the admin only). */
export interface HouseholdSentInviteView {
  inviteId: string;
  invitee: HouseholdPersonView;
  createdAt: number;
}

/** `household.mine`: the viewer's household, or null when they are in none. */
export interface HouseholdView {
  householdId: string;
  viewerRole: HouseholdRole;
  members: HouseholdMemberView[];
  pendingInvites: HouseholdSentInviteView[];
}

/** `household.myInvites`: a pending invite the viewer received. */
export interface HouseholdIncomingInviteView {
  inviteId: string;
  inviter: HouseholdPersonView;
  createdAt: number;
}

/**
 * `household.copies`: another member's copy as it appears in the viewer's library. `viewerAccess`
 * is the owner's per-copy permission for the household (absent on the row = "manage"). Owner-only
 * fields (notes, acquisition) are included only for "manage" (co-owner) access.
 */
export interface HouseholdCopyView extends OwnedCopyView {
  household: {
    owner: HouseholdPersonView;
    viewerAccess: HouseholdCopyPermission;
  };
}

/**
 * `household.myCopyPermissions`: one of the viewer's OWN copies with the household permission it
 * currently grants (absent on the row = "manage"), for the household page's bulk editor.
 */
export interface HouseholdOwnCopyView extends OwnedCopyView {
  householdPermission: HouseholdCopyPermission;
}

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
  /** The members' own name for the household; absent when unnamed. Members only. */
  name?: string;
  viewerRole: HouseholdRole;
  members: HouseholdMemberView[];
  pendingInvites: HouseholdSentInviteView[];
  /** Household-wide permission for member copies without an explicit value (unset = "manage"). */
  defaultCopyPermission: HouseholdCopyPermission;
  /** How many copies, across all members, have no explicit value and so follow the default. */
  copiesUsingDefault: number;
}

/** `household.myInvites`: a pending invite the viewer received. */
export interface HouseholdIncomingInviteView {
  inviteId: string;
  inviter: HouseholdPersonView;
  createdAt: number;
}

/**
 * `household.copies`: another member's copy as it appears in the viewer's library. `viewerAccess`
 * is the copy's effective permission for the household (explicit, else household default, else
 * "manage"). Owner-only fields (notes, acquisition) are included only for "manage" access.
 */
export interface HouseholdCopyView extends OwnedCopyView {
  household: {
    owner: HouseholdPersonView;
    viewerAccess: HouseholdCopyPermission;
  };
}

/**
 * `household.myCopyPermissions`: one of the viewer's OWN copies with the household permission it
 * currently grants (explicit value, else the household default, else "manage"), and whether that
 * is the copy's own explicit value or inherited from the household default.
 */
export interface HouseholdOwnCopyView extends OwnedCopyView {
  householdPermission: HouseholdCopyPermission;
  permissionSource: "explicit" | "default";
}

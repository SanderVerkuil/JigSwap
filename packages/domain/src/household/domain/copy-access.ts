import { MemberId } from "./ids";

// What the copy's OWNER lets their household do with one copy: `manage` = act as if co-owner,
// `view` = see it in their library only. Stored per copy; an ABSENT value means the default, so
// existing copies need no backfill.
export type HouseholdCopyPermission = "manage" | "view";

// Default is `manage`: a household is a mutually accepted trust relationship among people who
// already share the physical shelf (see the households design spec, D1).
export const DEFAULT_HOUSEHOLD_COPY_PERMISSION: HouseholdCopyPermission =
  "manage";

export const resolveHouseholdCopyPermission = (
  stored: HouseholdCopyPermission | undefined,
): HouseholdCopyPermission => stored ?? DEFAULT_HOUSEHOLD_COPY_PERMISSION;

// The acting member's access to a copy through ownership or the household.
export type HouseholdCopyAccess = "owner" | "manage" | "view" | "none";

export interface HouseholdCopyFacts {
  readonly ownerId: MemberId;
  readonly householdPermission?: HouseholdCopyPermission;
}

// THE household access rule. `sharesHousehold` is whether the actor and the copy's owner are
// members of the same household (resolved by the caller from persistence).
export const householdCopyAccess = (
  copy: HouseholdCopyFacts,
  actorId: MemberId,
  sharesHousehold: boolean,
): HouseholdCopyAccess => {
  if (copy.ownerId === actorId) return "owner";
  if (!sharesHousehold) return "none";
  return resolveHouseholdCopyPermission(copy.householdPermission);
};

// May the actor act on the copy as if they owned it?
export const canManageHouseholdCopy = (access: HouseholdCopyAccess): boolean =>
  access === "owner" || access === "manage";

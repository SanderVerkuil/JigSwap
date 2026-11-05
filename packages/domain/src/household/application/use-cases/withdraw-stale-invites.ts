import { Household, MemberId } from "../../domain";
import { HouseholdDeps } from "./deps";

// After `departedId` left `household` or was removed from it (the household still exists): an
// invite speaks for the household only while its inviter is the household's admin, so pending
// invites whose inviter no longer is go, and so does any pending invite to the member who went
// (joining used it up; it must not let them back in). Withdrawn like a revoke: no event.
export const withdrawStaleInvites = async (
  deps: Pick<HouseholdDeps, "invites">,
  household: Household,
  departedId: MemberId,
): Promise<void> => {
  const pending = await deps.invites.listPendingForHousehold(household.id);
  for (const invite of pending) {
    if (
      invite.inviteeId === departedId ||
      !household.isAdmin(invite.inviterId)
    ) {
      await deps.invites.remove(invite.id);
    }
  }
};

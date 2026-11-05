import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { RemoveHouseholdMember } from "../ports/in";
import { HouseholdDeps } from "./deps";
import { withdrawStaleInvites } from "./withdraw-stale-invites";

// The admin removes another member of THEIR household (the aggregate enforces admin-only and
// not-self). The removed member's copies leave with them, and so does any invite still pending to
// them from this household, so it can't let them back in (withdrawStaleInvites).
export const makeRemoveHouseholdMember =
  (
    deps: Pick<HouseholdDeps, "households" | "invites" | "events" | "clock">,
  ): RemoveHouseholdMember =>
  async (cmd) => {
    const household = await deps.households.findByMember(cmd.actorId);
    if (!household) return err(HouseholdApplicationError.notInHousehold());

    const removed = household.remove(
      cmd.actorId,
      cmd.memberId,
      deps.clock.now(),
    );
    if (removed.isErr) return err(removed.error);

    await deps.households.save(household);
    await withdrawStaleInvites(deps, household, cmd.memberId);
    await deps.events.publish(household.pullEvents());
    return ok(undefined);
  };

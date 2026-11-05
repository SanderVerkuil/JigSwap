import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { LeaveHousehold } from "../ports/in";
import { HouseholdDeps } from "./deps";
import { withdrawStaleInvites } from "./withdraw-stale-invites";

// The actor leaves their household. Their copies leave with them implicitly (household visibility
// is derived from membership). The last member leaving dissolves the household and drops its
// pending invites; otherwise the invites they sent as admin, and any leftover invite to them, are
// withdrawn (withdrawStaleInvites).
export const makeLeaveHousehold =
  (
    deps: Pick<HouseholdDeps, "households" | "invites" | "events" | "clock">,
  ): LeaveHousehold =>
  async (cmd) => {
    const household = await deps.households.findByMember(cmd.actorId);
    if (!household) return err(HouseholdApplicationError.notInHousehold());

    const left = household.leave(cmd.actorId, deps.clock.now());
    if (left.isErr) return err(left.error);

    if (left.value.dissolved) {
      await deps.invites.removePendingForHousehold(household.id);
      await deps.households.remove(household.id);
    } else {
      await deps.households.save(household);
      await withdrawStaleInvites(deps, household, cmd.actorId);
    }
    await deps.events.publish(household.pullEvents());
    return ok(left.value);
  };

import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { LeaveHousehold } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The actor leaves their household. Their copies leave with them implicitly (household visibility
// is derived from membership). The last member leaving dissolves the household and drops its
// pending invites.
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
    }
    await deps.events.publish(household.pullEvents());
    return ok(left.value);
  };

import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { RemoveHouseholdMember } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The admin removes another member of THEIR household (the aggregate enforces admin-only and
// not-self). The removed member's copies leave with them.
export const makeRemoveHouseholdMember =
  (
    deps: Pick<HouseholdDeps, "households" | "events" | "clock">,
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
    await deps.events.publish(household.pullEvents());
    return ok(undefined);
  };

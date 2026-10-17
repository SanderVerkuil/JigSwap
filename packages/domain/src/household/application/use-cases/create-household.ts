import { err, ok } from "../../../shared-kernel";
import { Household } from "../../domain";
import { HouseholdApplicationError } from "../errors";
import { CreateHousehold } from "../ports/in";
import { HouseholdDeps } from "./deps";

// Found a household with the actor as admin — unless they already belong to one.
export const makeCreateHousehold =
  (
    deps: Pick<
      HouseholdDeps,
      "households" | "householdIds" | "events" | "clock"
    >,
  ): CreateHousehold =>
  async (cmd) => {
    if (await deps.households.findByMember(cmd.actorId)) {
      return err(HouseholdApplicationError.alreadyInHousehold());
    }
    const household = Household.found({
      id: deps.householdIds.next(),
      founderId: cmd.actorId,
      now: deps.clock.now(),
    });
    await deps.households.save(household);
    await deps.events.publish(household.pullEvents());
    return ok(household.id);
  };

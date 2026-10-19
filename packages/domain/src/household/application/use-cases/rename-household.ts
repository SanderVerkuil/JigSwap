import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { RenameHousehold } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The admin names (or un-names) THEIR household; the aggregate enforces admin-only and the name
// rule. Nothing is notified.
export const makeRenameHousehold =
  (deps: Pick<HouseholdDeps, "households">): RenameHousehold =>
  async (cmd) => {
    const household = await deps.households.findByMember(cmd.actorId);
    if (!household) return err(HouseholdApplicationError.notInHousehold());

    const result = household.rename(cmd.actorId, cmd.name);
    if (result.isErr) return err(result.error);

    await deps.households.save(household);
    return ok(undefined);
  };

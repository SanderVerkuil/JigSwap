import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { SetHouseholdDefaultCopyPermission } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The admin sets THEIR household's default copy permission (the aggregate enforces admin-only).
// It applies at read time to every member copy without an explicit value; nothing is notified.
export const makeSetHouseholdDefaultCopyPermission =
  (
    deps: Pick<HouseholdDeps, "households">,
  ): SetHouseholdDefaultCopyPermission =>
  async (cmd) => {
    const household = await deps.households.findByMember(cmd.actorId);
    if (!household) return err(HouseholdApplicationError.notInHousehold());

    const result = household.setDefaultCopyPermission(
      cmd.actorId,
      cmd.permission,
    );
    if (result.isErr) return err(result.error);

    await deps.households.save(household);
    return ok(result.value);
  };

import { err, ok } from "../../../shared-kernel";
import { HouseholdError } from "../../domain";
import { HouseholdApplicationError } from "../errors";
import { DeclineHouseholdJoinRequest } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The household's admin declines; silent to the requester (no event), who keeps seeing it as
// waiting until it lapses. A request that is no longer open to answer is left as it is.
export const makeDeclineHouseholdJoinRequest =
  (
    deps: Pick<HouseholdDeps, "households" | "joinRequests" | "clock">,
  ): DeclineHouseholdJoinRequest =>
  async (cmd) => {
    const request = await deps.joinRequests.findById(cmd.requestId);
    if (!request) return err(HouseholdApplicationError.joinRequestNotFound());
    const household = await deps.households.findById(request.householdId);
    if (!household?.isAdmin(cmd.actorId)) {
      return err(HouseholdError.notHouseholdAdmin());
    }

    const now = deps.clock.now();
    if (!request.isActionable(now)) return ok(undefined);
    const declined = request.decline(now);
    if (declined.isErr) return err(declined.error);
    await deps.joinRequests.save(request);
    return ok(undefined);
  };

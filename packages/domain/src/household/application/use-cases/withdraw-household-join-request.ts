import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { WithdrawHouseholdJoinRequest } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The requester withdraws their open request (a silently declined one included). No event.
export const makeWithdrawHouseholdJoinRequest =
  (
    deps: Pick<HouseholdDeps, "joinRequests" | "clock">,
  ): WithdrawHouseholdJoinRequest =>
  async (cmd) => {
    const request = await deps.joinRequests.findById(cmd.requestId);
    if (!request) return err(HouseholdApplicationError.joinRequestNotFound());

    const withdrawn = request.withdraw(cmd.actorId, deps.clock.now());
    if (withdrawn.isErr) return err(withdrawn.error);
    await deps.joinRequests.save(request);
    return ok(undefined);
  };

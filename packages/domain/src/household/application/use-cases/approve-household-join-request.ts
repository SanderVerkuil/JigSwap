import { err, ok } from "../../../shared-kernel";
import { HouseholdError } from "../../domain";
import { HouseholdApplicationError } from "../errors";
import { ApproveHouseholdJoinRequest } from "../ports/in";
import { HouseholdDeps } from "./deps";
import { switchHousehold } from "./switch-household";

// The household's admin lets the requester in. A request that can no longer be approved answers
// "closed", whatever the reason (withdrawn, declined, lapsed, dropped, the pair blocked, the
// requester already a member, or their household situation no longer matching their consent), so
// the admin never learns the requester's household status. A consent mismatch voids the request
// for good. Otherwise the requester switches exactly like accepting an invite (switchHousehold):
// every check runs before any write.
export const makeApproveHouseholdJoinRequest =
  (
    deps: Pick<
      HouseholdDeps,
      "households" | "invites" | "joinRequests" | "events" | "clock"
    >,
  ): ApproveHouseholdJoinRequest =>
  async (cmd) => {
    const request = await deps.joinRequests.findById(cmd.requestId);
    if (!request) return err(HouseholdApplicationError.joinRequestNotFound());
    const household = await deps.households.findById(request.householdId);
    if (!household?.isAdmin(cmd.actorId)) {
      return err(HouseholdError.notHouseholdAdmin());
    }

    const now = deps.clock.now();
    if (!request.isActionable(now) || cmd.blocked) return ok("closed");

    const current = await deps.households.findByMember(request.requesterId);
    if (current?.id === household.id || !request.consentHolds(current)) {
      const voided = request.void(now);
      if (voided.isErr) return err(voided.error);
      await deps.joinRequests.save(request);
      return ok("closed");
    }

    const approved = request.approve(cmd.actorId, now);
    if (approved.isErr) return err(approved.error);
    const switched = await switchHousehold(deps, {
      memberId: request.requesterId,
      current,
      target: household,
      now,
    });
    if (switched.isErr) return err(switched.error);
    await deps.joinRequests.save(request);
    await deps.events.publish([
      ...(current?.pullEvents() ?? []),
      ...request.pullEvents(),
      ...household.pullEvents(),
    ]);
    return ok("joined");
  };

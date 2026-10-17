import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { AcceptHouseholdInvite } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The invitee accepts: the authoritative at-most-one-household check happens here (they may have
// joined or founded another household since the invite was sent), and the household must still
// exist. Nothing is persisted unless every check passes.
export const makeAcceptHouseholdInvite =
  (
    deps: Pick<HouseholdDeps, "households" | "invites" | "events" | "clock">,
  ): AcceptHouseholdInvite =>
  async (cmd) => {
    const invite = await deps.invites.findById(cmd.inviteId);
    if (!invite) return err(HouseholdApplicationError.inviteNotFound());

    const now = deps.clock.now();
    const accepted = invite.accept(cmd.actorId, now);
    if (accepted.isErr) return err(accepted.error);

    if (await deps.households.findByMember(cmd.actorId)) {
      return err(HouseholdApplicationError.alreadyInHousehold());
    }
    const household = await deps.households.findById(invite.householdId);
    if (!household) return err(HouseholdApplicationError.householdNotFound());

    const admitted = household.admit(cmd.actorId, now);
    if (admitted.isErr) return err(admitted.error);

    await deps.invites.save(invite);
    await deps.households.save(household);
    await deps.events.publish([
      ...invite.pullEvents(),
      ...household.pullEvents(),
    ]);
    return ok(household.id);
  };

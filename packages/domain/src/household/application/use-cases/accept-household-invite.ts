import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { AcceptHouseholdInvite } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The invitee accepts: the authoritative at-most-one-household check happens here (they may have
// joined or founded another household since the invite was sent), and the household must still
// exist. An invitee in another household is refused (AlreadyInHousehold) unless they asked to
// leave it (leaveCurrentHousehold): then they leave it (the last member dissolves it and its
// pending invites; an admin hands over to the longest-standing member) and join, in one step.
// Every check runs before anything is persisted, so a refusal changes nothing; the composition
// root throws on any error, so the transaction never ends in zero or two households.
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

    // The household the invitee is in now, when it is another one than the invite's.
    const found = await deps.households.findByMember(cmd.actorId);
    const current = found && found.id !== invite.householdId ? found : null;
    if (current && !cmd.leaveCurrentHousehold) {
      return err(HouseholdApplicationError.alreadyInHousehold());
    }
    const household = await deps.households.findById(invite.householdId);
    if (!household) return err(HouseholdApplicationError.householdNotFound());

    const admitted = household.admit(cmd.actorId, now);
    if (admitted.isErr) return err(admitted.error);

    // Only now, with the join certain, leave the current household.
    if (current) {
      const left = current.leave(cmd.actorId, now);
      if (left.isErr) return err(left.error);
      if (left.value.dissolved) {
        await deps.invites.removePendingForHousehold(current.id);
        await deps.households.remove(current.id);
      } else {
        await deps.households.save(current);
      }
    }
    await deps.invites.save(invite);
    await deps.households.save(household);
    await deps.events.publish([
      ...(current?.pullEvents() ?? []),
      ...invite.pullEvents(),
      ...household.pullEvents(),
    ]);
    return ok(household.id);
  };

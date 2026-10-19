import { err, ok } from "../../../shared-kernel";
import { HouseholdError, HouseholdInvite } from "../../domain";
import { HouseholdApplicationError } from "../errors";
import { InviteToHousehold } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The admin invites a member who is not in THIS household. They may be in another one: the invite
// still reaches them, and on accept they choose whether to leave it (acceptHouseholdInvite's
// leaveCurrentHousehold). Not telling the inviter whether someone is in a household also keeps
// that fact private. One pending invite per (household, invitee).
export const makeInviteToHousehold =
  (
    deps: Pick<
      HouseholdDeps,
      "households" | "invites" | "inviteIds" | "events" | "clock"
    >,
  ): InviteToHousehold =>
  async (cmd) => {
    const household = await deps.households.findByMember(cmd.actorId);
    if (!household) return err(HouseholdApplicationError.notInHousehold());
    if (!household.isAdmin(cmd.actorId)) {
      return err(HouseholdError.notHouseholdAdmin());
    }
    if (household.isMember(cmd.inviteeId)) {
      return err(HouseholdError.alreadyMember());
    }
    if (await deps.invites.findPending(household.id, cmd.inviteeId)) {
      return err(HouseholdApplicationError.duplicateInvite());
    }

    const invite = HouseholdInvite.send({
      id: deps.inviteIds.next(),
      householdId: household.id,
      inviterId: cmd.actorId,
      inviteeId: cmd.inviteeId,
      now: deps.clock.now(),
    });
    if (invite.isErr) return err(invite.error);

    await deps.invites.save(invite.value);
    await deps.events.publish(invite.value.pullEvents());
    return ok(invite.value.id);
  };

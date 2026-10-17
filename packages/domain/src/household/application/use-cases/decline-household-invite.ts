import { err, ok } from "../../../shared-kernel";
import { HouseholdApplicationError } from "../errors";
import { DeclineHouseholdInvite } from "../ports/in";
import { HouseholdDeps } from "./deps";

// The invitee declines; silent to the inviter.
export const makeDeclineHouseholdInvite =
  (
    deps: Pick<HouseholdDeps, "invites" | "events" | "clock">,
  ): DeclineHouseholdInvite =>
  async (cmd) => {
    const invite = await deps.invites.findById(cmd.inviteId);
    if (!invite) return err(HouseholdApplicationError.inviteNotFound());

    const declined = invite.decline(cmd.actorId, deps.clock.now());
    if (declined.isErr) return err(declined.error);

    await deps.invites.save(invite);
    await deps.events.publish(invite.pullEvents());
    return ok(undefined);
  };

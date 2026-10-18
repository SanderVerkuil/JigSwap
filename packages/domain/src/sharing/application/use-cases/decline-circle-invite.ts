import { err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import { DeclineCircleInvite } from "../ports/in/circle-invites.port";
import { CircleInviteDeps } from "./circle-invite-deps";

// The invitee declines. Silent to the inviter (the event has no notification mapped); the invite
// simply leaves the pending list. Someone else's invite answers InviteNotFound.
export const makeDeclineCircleInvite =
  (
    deps: Pick<CircleInviteDeps, "invites" | "events" | "clock">,
  ): DeclineCircleInvite =>
  async (cmd) => {
    const invite = await deps.invites.findById(cmd.inviteId);
    if (!invite || invite.inviteeId !== cmd.actorId) {
      return err(SharingApplicationError.inviteNotFound());
    }

    const declined = invite.decline(cmd.actorId, deps.clock.now());
    if (declined.isErr) return err(declined.error);

    await deps.invites.save(invite);
    await deps.events.publish(invite.pullEvents());
    return ok(undefined);
  };

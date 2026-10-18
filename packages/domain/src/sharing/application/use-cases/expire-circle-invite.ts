import { ExpireCircleInvite } from "../ports/in/circle-invites.port";
import { CircleInviteDeps } from "./circle-invite-deps";

// Scheduled at the invite's expiresAt: flip it to expired if it is still pending. A no-op for an
// invite that is gone, already decided, or (defensively) not yet due.
export const makeExpireCircleInvite =
  (
    deps: Pick<CircleInviteDeps, "invites" | "events" | "clock">,
  ): ExpireCircleInvite =>
  async (cmd) => {
    const invite = await deps.invites.findById(cmd.inviteId);
    if (!invite || invite.expire(deps.clock.now()).isErr) return false;

    await deps.invites.save(invite);
    await deps.events.publish(invite.pullEvents());
    return true;
  };

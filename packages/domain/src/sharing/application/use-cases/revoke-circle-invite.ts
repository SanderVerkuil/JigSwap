import { err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import { RevokeCircleInvite } from "../ports/in/circle-invites.port";
import { CircleInviteDeps } from "./circle-invite-deps";

// The inviter or any current Admin withdraws an open invite. Anyone else (including the invitee
// and plain members) gets InviteNotFound, as for an unknown id.
export const makeRevokeCircleInvite =
  (
    deps: Pick<CircleInviteDeps, "circles" | "invites" | "events" | "clock">,
  ): RevokeCircleInvite =>
  async (cmd) => {
    const invite = await deps.invites.findById(cmd.inviteId);
    const circle = invite ? await deps.circles.findById(invite.circleId) : null;
    if (!invite || !circle)
      return err(SharingApplicationError.inviteNotFound());

    const revoked = invite.revoke(cmd.actorId, circle, deps.clock.now());
    if (revoked.isErr) {
      return err(
        revoked.error.code === "CannotRevokeInvite"
          ? SharingApplicationError.inviteNotFound()
          : revoked.error,
      );
    }

    await deps.invites.save(invite);
    await deps.events.publish(invite.pullEvents());
    return ok(undefined);
  };

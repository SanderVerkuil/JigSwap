import { err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import { AcceptCircleInvite } from "../ports/in/circle-invites.port";
import { CircleInviteDeps } from "./circle-invite-deps";

// The invitee accepts and joins the circle at the invite's permission, through the Circle's own
// admitInvitee (so MemberJoinedCircle is recorded exactly as for any join). Authorised by the
// invite, not by impersonating the inviter: admitInvitee re-checks that the inviter is still an
// Admin. The invitee is never seated next to someone they blocked or who blocked them: a block
// either way with ANY current member (the inviter included) refuses, because a third party's
// invite must not undo a block. A block, a lost Admin or a vanished circle all answer
// InviteNotFound, so the invitee never learns which (nor who in the circle has the block). Nothing
// is persisted unless every check passes.
export const makeAcceptCircleInvite =
  (
    deps: Pick<
      CircleInviteDeps,
      "circles" | "invites" | "policy" | "membershipIds" | "events" | "clock"
    >,
  ): AcceptCircleInvite =>
  async (cmd) => {
    const invite = await deps.invites.findById(cmd.inviteId);
    if (!invite || invite.inviteeId !== cmd.actorId) {
      return err(SharingApplicationError.inviteNotFound());
    }

    const now = deps.clock.now();
    const accepted = invite.accept(cmd.actorId, now);
    if (accepted.isErr) return err(accepted.error);

    const circle = await deps.circles.findById(invite.circleId);
    if (!circle) return err(SharingApplicationError.inviteNotFound());
    // At most MAX_CIRCLE_MEMBERS seats, so a bounded number of block lookups.
    for (const seat of circle.members) {
      if (seat.memberId === invite.inviteeId) continue;
      if (
        await deps.policy.isBlockedEitherWay(invite.inviteeId, seat.memberId)
      ) {
        return err(SharingApplicationError.inviteNotFound());
      }
    }

    const admitted = circle.admitInvitee(
      invite,
      deps.membershipIds.next(),
      now,
    );
    if (admitted.isErr) {
      return err(
        admitted.error.code === "NotCircleAdmin"
          ? SharingApplicationError.inviteNotFound()
          : admitted.error,
      );
    }

    await deps.invites.save(invite);
    await deps.circles.save(circle);
    await deps.events.publish([...invite.pullEvents(), ...circle.pullEvents()]);
    return ok(circle.id);
  };

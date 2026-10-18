import { DomainEvent, err, ok } from "../../../shared-kernel";
import { CircleInvite, MAX_CIRCLE_MEMBERS, SharingError } from "../../domain";
import { SharingApplicationError } from "../errors";
import { InviteToCircle } from "../ports/in/circle-invites.port";
import { CircleInviteDeps } from "./circle-invite-deps";

// An Admin invites a member they may contact. Order matters: a non-member actor gets
// CircleNotFound (no probing which circles exist), the contact rule runs before the idempotency
// lookup so a now-uncontactable member is refused even with an old invite, and the cap counts
// members plus every still-open invite. One open invite per (circle, invitee): a repeat returns
// it; a stale pending one (past its expiry, not yet flipped) is expired here first.
export const makeInviteToCircle =
  (
    deps: Pick<
      CircleInviteDeps,
      "circles" | "invites" | "policy" | "inviteIds" | "events" | "clock"
    >,
  ): InviteToCircle =>
  async (cmd) => {
    const circle = await deps.circles.findById(cmd.circleId);
    if (!circle || !circle.isMember(cmd.actorId)) {
      return err(SharingApplicationError.circleNotFound(cmd.circleId));
    }
    if (!circle.isAdmin(cmd.actorId)) return err(SharingError.notCircleAdmin());
    if (circle.isMember(cmd.inviteeId))
      return err(SharingError.alreadyMember());
    if (!(await deps.policy.canInvite(cmd.actorId, cmd.inviteeId))) {
      return err(SharingError.cannotInvite());
    }

    const now = deps.clock.now();
    const pending: DomainEvent[] = [];
    const existing = await deps.invites.findPending(circle.id, cmd.inviteeId);
    if (existing) {
      if (existing.isOpenAt(now)) return ok(existing.id);
      existing.expire(now);
      await deps.invites.save(existing);
      pending.push(...existing.pullEvents());
    }

    const open = (await deps.invites.listPendingForCircle(circle.id)).filter(
      (invite) => invite.isOpenAt(now),
    );
    if (circle.members.length + open.length >= MAX_CIRCLE_MEMBERS) {
      return err(SharingError.circleFull());
    }

    const invite = CircleInvite.issue({
      id: deps.inviteIds.next(),
      circleId: circle.id,
      inviterId: cmd.actorId,
      inviteeId: cmd.inviteeId,
      permission: cmd.permission,
      now,
    });
    if (invite.isErr) return err(invite.error);

    await deps.invites.save(invite.value);
    await deps.events.publish([...pending, ...invite.value.pullEvents()]);
    return ok(invite.value.id);
  };

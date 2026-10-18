import { DomainEvent } from "../../../shared-kernel";
import { WithdrawInvitesFrom } from "../ports/in/circle-invites.port";
import { CircleInviteDeps } from "./circle-invite-deps";

// When a member leaves a circle, is removed, or loses Admin, every invite they still have pending
// there is withdrawn in the same transaction: nobody joins on the word of someone who can no
// longer invite, and the seats those invites held free up.
export const makeWithdrawInvitesFrom =
  (
    deps: Pick<CircleInviteDeps, "invites" | "events" | "clock">,
  ): WithdrawInvitesFrom =>
  async (cmd) => {
    const now = deps.clock.now();
    const pending = (
      await deps.invites.listPendingForCircle(cmd.circleId)
    ).filter((invite) => invite.inviterId === cmd.inviterId);
    const events: DomainEvent[] = [];
    for (const invite of pending) {
      invite.withdraw(now);
      await deps.invites.save(invite);
      events.push(...invite.pullEvents());
    }
    await deps.events.publish(events);
    return pending.length;
  };

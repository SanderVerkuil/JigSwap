import { Clock, DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import { IdentityApplicationError } from "../errors";
import {
  DeactivateMember,
  DeactivateMemberCommand,
} from "../ports/in/deactivate-member.port";
import { MemberRepository } from "../ports/out/member.repository";

export interface DeactivateMemberDeps {
  readonly members: MemberRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the Member (MemberNotFound if absent) and deactivate it. The
// aggregate makes deactivation idempotent, so a second call publishes no event — we still save
// to keep the updatedAt write path uniform, but pullEvents yields nothing.
export const makeDeactivateMember =
  (deps: DeactivateMemberDeps): DeactivateMember =>
  async (
    cmd: DeactivateMemberCommand,
  ): Promise<Result<void, IdentityApplicationError>> => {
    const member = await deps.members.findById(cmd.memberId);
    if (!member) return err(IdentityApplicationError.memberNotFound(cmd.memberId));

    member.deactivate(deps.clock.now());

    await deps.members.save(member);
    await deps.events.publish(member.pullEvents());

    return ok(undefined);
  };

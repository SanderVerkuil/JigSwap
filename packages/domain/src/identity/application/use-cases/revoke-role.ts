import { Clock, DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import { createRole, IdentityError } from "../../domain";
import { IdentityApplicationError } from "../errors";
import { RevokeRole, RevokeRoleCommand } from "../ports/in/revoke-role.port";
import { MemberRepository } from "../ports/out/member.repository";

export interface RevokeRoleDeps {
  readonly members: MemberRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: validate the raw role string (InvalidRole if unknown), load the Member
// (MemberNotFound if absent), then withdraw. The aggregate audits the withdrawal via RoleRevoked
// only when the role was actually held, so revoking an unheld role publishes nothing.
export const makeRevokeRole =
  (deps: RevokeRoleDeps): RevokeRole =>
  async (
    cmd: RevokeRoleCommand,
  ): Promise<Result<void, IdentityError | IdentityApplicationError>> => {
    const role = createRole(cmd.role);
    if (role.isErr) return err(role.error);

    const member = await deps.members.findById(cmd.memberId);
    if (!member) return err(IdentityApplicationError.memberNotFound(cmd.memberId));

    member.revokeRole(role.value, deps.clock.now());

    await deps.members.save(member);
    await deps.events.publish(member.pullEvents());

    return ok(undefined);
  };

import { Clock, DomainEventPublisher, err, ok, Result } from "../../../shared-kernel";
import { createRole, IdentityError } from "../../domain";
import { IdentityApplicationError } from "../errors";
import { AssignRole, AssignRoleCommand } from "../ports/in/assign-role.port";
import { MemberRepository } from "../ports/out/member.repository";

export interface AssignRoleDeps {
  readonly members: MemberRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: validate the raw role string (InvalidRole if unknown), load the Member
// (MemberNotFound if absent), then grant. The aggregate audits the grant via RoleAssigned only
// when the role is newly added, so re-assigning a held role publishes nothing.
export const makeAssignRole =
  (deps: AssignRoleDeps): AssignRole =>
  async (
    cmd: AssignRoleCommand,
  ): Promise<Result<void, IdentityError | IdentityApplicationError>> => {
    const role = createRole(cmd.role);
    if (role.isErr) return err(role.error);

    const member = await deps.members.findById(cmd.memberId);
    if (!member) return err(IdentityApplicationError.memberNotFound(cmd.memberId));

    member.assignRole(role.value, deps.clock.now());

    await deps.members.save(member);
    await deps.events.publish(member.pullEvents());

    return ok(undefined);
  };

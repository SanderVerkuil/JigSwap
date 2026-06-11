import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import { AddMember, AddMemberCommand } from "../ports/in/add-member.port";
import { CircleRepository } from "../ports/out/circle.repository";
import { MembershipIdGenerator } from "../ports/out/id-generators";

export interface AddMemberDeps {
  readonly circles: CircleRepository;
  readonly membershipIds: MembershipIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the circle (CircleNotFound if missing), delegate the admin-gated add to
// the aggregate, persist, publish MemberJoinedCircle. All authorisation lives in the aggregate.
export const makeAddMember =
  (deps: AddMemberDeps): AddMember =>
  async (cmd: AddMemberCommand) => {
    const circle = await deps.circles.findById(cmd.circleId);
    if (!circle)
      return err(SharingApplicationError.circleNotFound(cmd.circleId));

    const result = circle.addMember(
      cmd.actorId,
      deps.membershipIds.next(),
      cmd.memberId,
      cmd.permission,
      deps.clock.now(),
    );
    if (result.isErr) return err(result.error);

    await deps.circles.save(circle);
    await deps.events.publish(circle.pullEvents());
    return ok(undefined);
  };

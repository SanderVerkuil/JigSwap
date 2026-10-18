import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import { LeaveCircle, LeaveCircleCommand } from "../ports/in/leave-circle.port";
import { CircleRepository } from "../ports/out/circle.repository";

export interface LeaveCircleDeps {
  readonly circles: CircleRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the circle (CircleNotFound if missing), delegate the leave (which
// refuses the owner and non-members) to the aggregate, persist, publish MemberLeftCircle.
export const makeLeaveCircle =
  (deps: LeaveCircleDeps): LeaveCircle =>
  async (cmd: LeaveCircleCommand) => {
    const circle = await deps.circles.findById(cmd.circleId);
    if (!circle)
      return err(SharingApplicationError.circleNotFound(cmd.circleId));

    const result = circle.leave(cmd.memberId, deps.clock.now());
    if (result.isErr) return err(result.error);

    await deps.circles.save(circle);
    await deps.events.publish(circle.pullEvents());
    return ok(undefined);
  };

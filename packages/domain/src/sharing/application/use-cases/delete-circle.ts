import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import {
  DeleteCircle,
  DeleteCircleCommand,
} from "../ports/in/delete-circle.port";
import { CircleRepository } from "../ports/out/circle.repository";

export interface DeleteCircleDeps {
  readonly circles: CircleRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the circle (CircleNotFound if missing), let the aggregate authorise the
// deletion (owner only, exact name), delete it, publish CircleDeleted. Cleaning up what hangs off
// the circle (invites, copy-share links) is the publisher's reaction to that event.
export const makeDeleteCircle =
  (deps: DeleteCircleDeps): DeleteCircle =>
  async (cmd: DeleteCircleCommand) => {
    const circle = await deps.circles.findById(cmd.circleId);
    if (!circle)
      return err(SharingApplicationError.circleNotFound(cmd.circleId));

    const result = circle.delete(
      cmd.actorId,
      cmd.confirmName,
      deps.clock.now(),
    );
    if (result.isErr) return err(result.error);

    await deps.circles.delete(circle);
    await deps.events.publish(circle.pullEvents());
    return ok(undefined);
  };

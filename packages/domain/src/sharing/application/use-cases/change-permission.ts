import { DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import {
  ChangePermission,
  ChangePermissionCommand,
} from "../ports/in/change-permission.port";
import { CircleRepository } from "../ports/out/circle.repository";

export interface ChangePermissionDeps {
  readonly circles: CircleRepository;
  readonly events: DomainEventPublisher;
}

// Transaction script: load the circle (CircleNotFound if missing), delegate the admin-gated
// permission change (which refuses the owner and no-op changes) to the aggregate, persist.
export const makeChangePermission =
  (deps: ChangePermissionDeps): ChangePermission =>
  async (cmd: ChangePermissionCommand) => {
    const circle = await deps.circles.findById(cmd.circleId);
    if (!circle) return err(SharingApplicationError.circleNotFound(cmd.circleId));

    const result = circle.changePermission(cmd.actorId, cmd.memberId, cmd.permission);
    if (result.isErr) return err(result.error);

    await deps.circles.save(circle);
    await deps.events.publish(circle.pullEvents());
    return ok(undefined);
  };

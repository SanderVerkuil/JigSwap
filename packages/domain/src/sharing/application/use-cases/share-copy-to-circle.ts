import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import {
  ShareCopyToCircle,
  ShareCopyToCircleCommand,
} from "../ports/in/share-copy-to-circle.port";
import { CircleRepository } from "../ports/out/circle.repository";

export interface ShareCopyToCircleDeps {
  readonly circles: CircleRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load the circle (CircleNotFound if missing), delegate the admin-gated share
// to the aggregate, persist, publish CopySharedToCircle. The copy link itself lives in a read
// model fed by that event — Sharing owns no copy state.
export const makeShareCopyToCircle =
  (deps: ShareCopyToCircleDeps): ShareCopyToCircle =>
  async (cmd: ShareCopyToCircleCommand) => {
    const circle = await deps.circles.findById(cmd.circleId);
    if (!circle)
      return err(SharingApplicationError.circleNotFound(cmd.circleId));

    const result = circle.shareCopy(cmd.actorId, cmd.copyId, deps.clock.now());
    if (result.isErr) return err(result.error);

    await deps.circles.save(circle);
    await deps.events.publish(circle.pullEvents());
    return ok(undefined);
  };

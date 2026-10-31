import { err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import {
  ShareCopiesToCircle,
  ShareCopiesToCircleCommand,
} from "../ports/in/share-copies-to-circle.port";
import { ShareCopyToCircleDeps } from "./share-copy-to-circle";

// Transaction script: load the circle once, gate the whole batch on the actor's seat
// (Circle.shareCopies), persist once and publish one CopySharedToCircle per copy. All or nothing.
// A non-member gets the same CircleNotFound as an unknown circle, so the batch can't be used to
// probe which circles exist.
export const makeShareCopiesToCircle =
  (deps: ShareCopyToCircleDeps): ShareCopiesToCircle =>
  async (cmd: ShareCopiesToCircleCommand) => {
    const circle = await deps.circles.findById(cmd.circleId);
    if (!circle || !circle.isMember(cmd.actorId)) {
      return err(SharingApplicationError.circleNotFound(cmd.circleId));
    }

    const result = circle.shareCopies(
      cmd.actorId,
      cmd.copyIds,
      deps.clock.now(),
    );
    if (result.isErr) return err(result.error);

    if (cmd.copyIds.length > 0) {
      await deps.circles.save(circle);
      await deps.events.publish(circle.pullEvents());
    }
    return ok(undefined);
  };

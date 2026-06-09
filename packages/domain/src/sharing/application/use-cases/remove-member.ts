import { DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { SharingApplicationError } from "../errors";
import { RemoveMember, RemoveMemberCommand } from "../ports/in/remove-member.port";
import { CircleRepository } from "../ports/out/circle.repository";

export interface RemoveMemberDeps {
  readonly circles: CircleRepository;
  readonly events: DomainEventPublisher;
}

// Transaction script: load the circle (CircleNotFound if missing), delegate the admin-gated removal
// (which also refuses to remove the owner) to the aggregate, persist. Removal records no event.
export const makeRemoveMember =
  (deps: RemoveMemberDeps): RemoveMember =>
  async (cmd: RemoveMemberCommand) => {
    const circle = await deps.circles.findById(cmd.circleId);
    if (!circle) return err(SharingApplicationError.circleNotFound(cmd.circleId));

    const result = circle.removeMember(cmd.actorId, cmd.memberId);
    if (result.isErr) return err(result.error);

    await deps.circles.save(circle);
    await deps.events.publish(circle.pullEvents());
    return ok(undefined);
  };

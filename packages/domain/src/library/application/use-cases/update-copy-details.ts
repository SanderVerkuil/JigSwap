import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  UpdateCopyDetails,
  UpdateCopyDetailsCommand,
} from "../ports/in/update-copy-details.port";
import { CopyRepository } from "../ports/out/copy.repository";

export interface UpdateCopyDetailsDeps {
  readonly copies: CopyRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CopyNotFound), check ownership, delegate the descriptive-field
// patch (missing-piece count, notes) to the aggregate, persist, publish.
export const makeUpdateCopyDetails =
  (deps: UpdateCopyDetailsDeps): UpdateCopyDetails =>
  async (cmd: UpdateCopyDetailsCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));
    if (copy.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("update this copy's details"));
    }

    const outcome = copy.updateDetails(
      {
        missingPiecesCount: cmd.missingPiecesCount,
        notes: cmd.notes,
      },
      deps.clock.now(),
    );
    if (outcome.isErr) return err(outcome.error);

    await deps.copies.save(copy);
    await deps.events.publish(copy.pullEvents());
    return ok(undefined);
  };

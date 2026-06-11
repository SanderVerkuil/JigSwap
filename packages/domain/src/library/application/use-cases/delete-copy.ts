import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError } from "../../domain";
import { LibraryApplicationError } from "../errors";
import { DeleteCopy, DeleteCopyCommand } from "../ports/in/delete-copy.port";
import { CopyReservationPort } from "../ports/out/copy-reservation.port";
import { CopyRepository } from "../ports/out/copy.repository";

export interface DeleteCopyDeps {
  readonly copies: CopyRepository;
  // The seam to Exchange: a copy reserved by an active exchange must not be deleted out from
  // under it. Reservation state lives in the Exchange context, so we ask through this port.
  readonly reservations: CopyReservationPort;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CopyNotFound), check ownership, guard against deleting a copy
// reserved by an active Exchange (→ CopyReserved, an APPLICATION-level rule that needs Exchange
// state), then remove from the repository and publish the aggregate's CopyDeleted event.
export const makeDeleteCopy =
  (deps: DeleteCopyDeps): DeleteCopy =>
  async (cmd: DeleteCopyCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));
    if (copy.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("delete this copy"));
    }

    if (await deps.reservations.isReserved(cmd.copyId)) {
      return err(LibraryApplicationError.copyReserved(cmd.copyId));
    }

    const outcome = copy.delete(deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.copies.remove(copy.id);
    await deps.events.publish(copy.pullEvents());
    return ok(undefined);
  };

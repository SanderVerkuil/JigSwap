import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError, SharingSetting } from "../../domain";
import { LibraryApplicationError } from "../errors";
import {
  UpdateCopySharing,
  UpdateCopySharingCommand,
} from "../ports/in/update-copy-sharing.port";
import { CopyReservationPort } from "../ports/out/copy-reservation.port";
import { CopyRepository } from "../ports/out/copy.repository";

export interface UpdateCopySharingDeps {
  readonly copies: CopyRepository;
  // The seam to Exchange: enforces "cannot make available while reserved by an active Exchange".
  readonly reservations: CopyReservationPort;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Transaction script: load (→ CopyNotFound), check ownership, and — only when the new setting
// offers the copy for exchange — consult the reservation seam before letting the aggregate
// update its sharing. The "reserved by an active Exchange" rule is APPLICATION-level (it needs
// Exchange state), so it lives here, not in the Copy aggregate.
export const makeUpdateCopySharing =
  (deps: UpdateCopySharingDeps): UpdateCopySharing =>
  async (cmd: UpdateCopySharingCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));
    if (copy.ownerId !== cmd.actingMemberId) {
      return err(LibraryError.notOwner("update this copy's sharing"));
    }

    const setting = SharingSetting.create({
      visibility: cmd.visibility,
      forTrade: cmd.forTrade,
      forSale: cmd.forSale,
      forLend: cmd.forLend,
      salePrice: cmd.salePrice,
    });

    if (
      setting.isAvailableForAnyExchange() &&
      (await deps.reservations.isReserved(cmd.copyId))
    ) {
      return err(LibraryApplicationError.copyReserved(cmd.copyId));
    }

    const outcome = copy.updateSharing(setting, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.copies.save(copy);
    await deps.events.publish(copy.pullEvents());
    return ok(undefined);
  };

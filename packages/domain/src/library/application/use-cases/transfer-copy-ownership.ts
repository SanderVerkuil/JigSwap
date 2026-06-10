import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryApplicationError } from "../errors";
import {
  TransferCopyOwnership,
  TransferCopyOwnershipCommand,
} from "../ports/in/transfer-copy-ownership.port";
import { CopyRepository } from "../ports/out/copy.repository";

export interface TransferCopyOwnershipDeps {
  readonly copies: CopyRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Settlement-driven (no acting member): load the copy (→ CopyNotFound), hand the ownership move to
// the aggregate (resets owner-scoped fields, keeps the physical record), persist, publish.
export const makeTransferCopyOwnership =
  (deps: TransferCopyOwnershipDeps): TransferCopyOwnership =>
  async (cmd: TransferCopyOwnershipCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));

    const outcome = copy.transferTo(cmd.newOwner, deps.clock.now());
    if (outcome.isErr) return err(outcome.error);

    await deps.copies.save(copy);
    await deps.events.publish(copy.pullEvents());
    return ok(undefined);
  };

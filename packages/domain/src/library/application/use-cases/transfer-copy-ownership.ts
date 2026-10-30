import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryApplicationError } from "../errors";
import {
  TransferCopyOwnership,
  TransferCopyOwnershipCommand,
} from "../ports/in/transfer-copy-ownership.port";
import { CopyRepository } from "../ports/out/copy.repository";
import { LoanRepository } from "../ports/out/loan.repository";

export interface TransferCopyOwnershipDeps {
  readonly copies: CopyRepository;
  readonly loans: LoanRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Settlement-driven (no acting member): load the copy (→ CopyNotFound), hand the ownership move to
// the aggregate (refuses once the copy no longer belongs to the expected previous owner; resets
// owner-scoped fields, keeps the physical record), persist, publish. Possession goes to the new
// owner with it, so any loan still open on the copy ends (recalled); a refused move ends none.
export const makeTransferCopyOwnership =
  (deps: TransferCopyOwnershipDeps): TransferCopyOwnership =>
  async (cmd: TransferCopyOwnershipCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));

    const now = deps.clock.now();
    const outcome = copy.transferTo(
      cmd.newOwner,
      now,
      cmd.expectedPreviousOwner,
    );
    if (outcome.isErr) return err(outcome.error);

    const openLoans = await deps.loans.findOpenByCopy(cmd.copyId);
    for (const loan of openLoans) {
      const ended = loan.endByTransfer(now);
      if (ended.isErr) return err(ended.error);
    }

    for (const loan of openLoans) await deps.loans.save(loan);
    await deps.copies.save(copy);
    await deps.events.publish([
      ...openLoans.flatMap((loan) => loan.pullEvents()),
      ...copy.pullEvents(),
    ]);
    return ok(undefined);
  };

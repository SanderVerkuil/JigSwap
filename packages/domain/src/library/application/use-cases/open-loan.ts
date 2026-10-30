import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryError, Loan } from "../../domain";
import { LibraryApplicationError } from "../errors";
import { OpenLoan, OpenLoanCommand } from "../ports/in/open-loan.port";
import { CopyRepository } from "../ports/out/copy.repository";
import { LoanIdGenerator } from "../ports/out/id-generators";
import { LoanRepository } from "../ports/out/loan.repository";

export interface OpenLoanDeps {
  readonly copies: CopyRepository;
  readonly loans: LoanRepository;
  readonly ids: LoanIdGenerator;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// Settlement reaction: open an open-ended loan and hand possession of the copy to the borrower.
// The lender is the copy's current owner, and must be the owner the lend was agreed with
// (OwnershipChanged otherwise): a copy is never lent out of someone else's library. One loan per
// copy: while another loan the owner made on it is open, or anyone but the owner holds it, nothing
// opens (AlreadyLentOut). A loan a former owner left open (a transfer before transfers ended loans)
// is stale and holds nothing against the current owner. Ownership is untouched (only heldBy moves).
export const makeOpenLoan =
  (deps: OpenLoanDeps): OpenLoan =>
  async (cmd: OpenLoanCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));
    if (cmd.lender !== undefined && copy.ownerId !== cmd.lender) {
      return err(LibraryError.ownershipChanged());
    }
    const openLoans = await deps.loans.findOpenByCopy(cmd.copyId);
    if (openLoans.some((loan) => loan.lenderId === copy.ownerId)) {
      return err(LibraryError.alreadyLentOut());
    }

    const now = deps.clock.now();
    const opened = Loan.open({
      id: deps.ids.next(),
      copyId: cmd.copyId,
      lenderId: copy.ownerId,
      borrowerId: cmd.borrowerId,
      expectedReturn: cmd.expectedReturn,
      now,
    });
    if (opened.isErr) return err(opened.error);

    const lent = copy.lendOut(cmd.borrowerId, now);
    if (lent.isErr) return err(lent.error);
    await deps.loans.save(opened.value);
    await deps.copies.save(copy);
    await deps.events.publish([
      ...opened.value.pullEvents(),
      ...copy.pullEvents(),
    ]);
    return ok(opened.value.id);
  };

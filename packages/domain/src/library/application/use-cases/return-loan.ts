import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryApplicationError } from "../errors";
import { CloseLoanCommand, ReturnLoan } from "../ports/in/close-loan.port";
import { CopyRepository } from "../ports/out/copy.repository";
import { LoanRepository } from "../ports/out/loan.repository";

export interface ReturnLoanDeps {
  readonly loans: LoanRepository;
  readonly copies: CopyRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// The borrower hands the copy back: close the loan (only the borrower may) and return possession,
// but only while this loan's borrower holds the copy: closing an older loan never takes the copy
// away from whoever holds it now.
export const makeReturnLoan =
  (deps: ReturnLoanDeps): ReturnLoan =>
  async (cmd: CloseLoanCommand) => {
    const loan = await deps.loans.findById(cmd.loanId);
    if (!loan) return err(LibraryApplicationError.loanNotFound(cmd.loanId));

    const now = deps.clock.now();
    const closed = loan.returnByBorrower(cmd.actingMemberId, now);
    if (closed.isErr) return err(closed.error);

    const found = await deps.copies.findById(loan.copyId);
    const copy = found?.heldBy === loan.borrowerId ? found : null;
    if (copy) {
      const returned = copy.returnToOwner(now);
      if (returned.isErr) return err(returned.error);
    }
    await deps.loans.save(loan);
    if (copy) await deps.copies.save(copy);
    await deps.events.publish([
      ...loan.pullEvents(),
      ...(copy?.pullEvents() ?? []),
    ]);
    return ok(undefined);
  };

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

// The borrower hands the copy back: close the loan (only the borrower may) and return possession.
export const makeReturnLoan =
  (deps: ReturnLoanDeps): ReturnLoan =>
  async (cmd: CloseLoanCommand) => {
    const loan = await deps.loans.findById(cmd.loanId);
    if (!loan) return err(LibraryApplicationError.loanNotFound(cmd.loanId));

    const now = deps.clock.now();
    const closed = loan.returnByBorrower(cmd.actingMemberId, now);
    if (closed.isErr) return err(closed.error);

    const copy = await deps.copies.findById(loan.copyId);
    if (copy) copy.returnToOwner(now);
    await deps.loans.save(loan);
    if (copy) await deps.copies.save(copy);
    await deps.events.publish([
      ...loan.pullEvents(),
      ...(copy?.pullEvents() ?? []),
    ]);
    return ok(undefined);
  };

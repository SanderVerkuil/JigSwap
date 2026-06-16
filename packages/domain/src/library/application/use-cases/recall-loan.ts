import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryApplicationError } from "../errors";
import { CloseLoanCommand, RecallLoan } from "../ports/in/close-loan.port";
import { CopyRepository } from "../ports/out/copy.repository";
import { LoanRepository } from "../ports/out/loan.repository";

export interface RecallLoanDeps {
  readonly loans: LoanRepository;
  readonly copies: CopyRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
}

// The owner asks for the copy back: close the loan (only the lender may) and return possession.
export const makeRecallLoan =
  (deps: RecallLoanDeps): RecallLoan =>
  async (cmd: CloseLoanCommand) => {
    const loan = await deps.loans.findById(cmd.loanId);
    if (!loan) return err(LibraryApplicationError.loanNotFound(cmd.loanId));

    const now = deps.clock.now();
    const closed = loan.recallByOwner(cmd.actingMemberId, now);
    if (closed.isErr) return err(closed.error);

    const copy = await deps.copies.findById(loan.copyId);
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

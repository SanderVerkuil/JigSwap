import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { LibraryApplicationError } from "../errors";
import { CloseLoanCommand, RecallLoan } from "../ports/in/close-loan.port";
import {
  CopyManagerPolicy,
  mayManageCopy,
} from "../ports/out/copy-manager.policy";
import { CopyRepository } from "../ports/out/copy.repository";
import { LoanRepository } from "../ports/out/loan.repository";

export interface RecallLoanDeps {
  readonly loans: LoanRepository;
  readonly copies: CopyRepository;
  readonly events: DomainEventPublisher;
  readonly clock: Clock;
  // Household co-management (optional): absent ⇒ lender-only.
  readonly managers?: CopyManagerPolicy;
}

// The owner asks for the copy back: close the loan (only the lender — or a household manager of the
// copy acting for them — may) and return possession.
export const makeRecallLoan =
  (deps: RecallLoanDeps): RecallLoan =>
  async (cmd: CloseLoanCommand) => {
    const loan = await deps.loans.findById(cmd.loanId);
    if (!loan) return err(LibraryApplicationError.loanNotFound(cmd.loanId));

    const now = deps.clock.now();
    const copy = await deps.copies.findById(loan.copyId);
    // A household manager of the lent copy recalls ON BEHALF of the lender (the loan's lender stays
    // the owner); anyone else is judged as themselves by the aggregate (→ NotLender).
    const recaller =
      copy &&
      cmd.actingMemberId !== loan.lenderId &&
      cmd.actingMemberId !== loan.toState().borrowerId &&
      (await mayManageCopy(copy, cmd.actingMemberId, deps.managers))
        ? loan.lenderId
        : cmd.actingMemberId;
    const closed = loan.recallByOwner(recaller, now);
    if (closed.isErr) return err(closed.error);

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

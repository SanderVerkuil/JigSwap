import { Clock, DomainEventPublisher, err, ok } from "../../../shared-kernel";
import { Loan } from "../../domain";
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
// The lender is the copy's current owner; ownership is untouched (only heldBy moves).
export const makeOpenLoan =
  (deps: OpenLoanDeps): OpenLoan =>
  async (cmd: OpenLoanCommand) => {
    const copy = await deps.copies.findById(cmd.copyId);
    if (!copy) return err(LibraryApplicationError.copyNotFound(cmd.copyId));

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

    copy.lendOut(cmd.borrowerId, now);
    await deps.loans.save(opened.value);
    await deps.copies.save(copy);
    await deps.events.publish([
      ...opened.value.pullEvents(),
      ...copy.pullEvents(),
    ]);
    return ok(opened.value.id);
  };

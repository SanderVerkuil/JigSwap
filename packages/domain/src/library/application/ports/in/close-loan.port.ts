import { Result } from "../../../../shared-kernel";
import { LibraryError, LoanId, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Closing a loan: the borrower returns it, or the owner recalls it. The acting member's role is
// checked by the aggregate (only the borrower may return; only the lender may recall).
export interface CloseLoanCommand {
  readonly loanId: LoanId;
  readonly actingMemberId: OwnerId;
}

export interface ReturnLoan {
  (
    cmd: CloseLoanCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}

export interface RecallLoan {
  (
    cmd: CloseLoanCommand,
  ): Promise<Result<void, LibraryError | LibraryApplicationError>>;
}

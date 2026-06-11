import { Result } from "../../../../shared-kernel";
import { CopyId, LibraryError, LoanId, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Settlement-driven: a lend exchange settled, so possession passes to the borrower. The lender is
// derived from the copy's owner; expectedReturn is advisory.
export interface OpenLoanCommand {
  readonly copyId: CopyId;
  readonly borrowerId: OwnerId;
  readonly expectedReturn?: Date;
}

export interface OpenLoan {
  (
    cmd: OpenLoanCommand,
  ): Promise<Result<LoanId, LibraryError | LibraryApplicationError>>;
}

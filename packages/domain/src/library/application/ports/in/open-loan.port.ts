import { Result } from "../../../../shared-kernel";
import { CopyId, LibraryError, LoanId, OwnerId } from "../../../domain";
import { LibraryApplicationError } from "../../errors";

// Settlement-driven: a lend exchange settled, so possession passes to the borrower. The loan's
// lender is the copy's owner; expectedReturn is advisory.
export interface OpenLoanCommand {
  readonly copyId: CopyId;
  readonly borrowerId: OwnerId;
  readonly expectedReturn?: Date;
  // The owner the lend was agreed with; refused (OwnershipChanged) once the copy belongs to anyone
  // else. Absent on settlements recorded before it was carried: no check.
  readonly lender?: OwnerId;
}

export interface OpenLoan {
  (
    cmd: OpenLoanCommand,
  ): Promise<Result<LoanId, LibraryError | LibraryApplicationError>>;
}

import { CopyId, Loan, LoanId } from "../../../domain";

// Outbound port: persistence for the Loan aggregate. The convex adapter implements this over the
// `loans` table behind a mapper; the domain never sees a row.
export interface LoanRepository {
  findById(id: LoanId): Promise<Loan | null>;
  // The copy's loans still open. A copy is lent to one borrower at a time, but rows written before
  // that rule may hold more than one.
  findOpenByCopy(copyId: CopyId): Promise<readonly Loan[]>;
  save(loan: Loan): Promise<void>;
}

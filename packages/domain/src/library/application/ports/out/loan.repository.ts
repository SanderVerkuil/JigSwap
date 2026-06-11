import { Loan, LoanId } from "../../../domain";

// Outbound port: persistence for the Loan aggregate. The convex adapter implements this over the
// `loans` table behind a mapper; the domain never sees a row.
export interface LoanRepository {
  findById(id: LoanId): Promise<Loan | null>;
  save(loan: Loan): Promise<void>;
}

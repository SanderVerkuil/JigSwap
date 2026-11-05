import { CopyId, Loan, LoanId } from "../../domain";
import { LoanRepository } from "../ports/out/loan.repository";

// In-memory LoanRepository for use-case tests; rehydrates a fresh aggregate on read.
export class InMemoryLoanRepository implements LoanRepository {
  private readonly store = new Map<LoanId, ReturnType<Loan["toState"]>>();

  async findById(id: LoanId): Promise<Loan | null> {
    const state = this.store.get(id);
    return state ? Loan.rehydrate(state) : null;
  }

  async findOpenByCopy(copyId: CopyId): Promise<readonly Loan[]> {
    return [...this.store.values()]
      .filter((state) => state.copyId === copyId && state.status === "open")
      .map((state) => Loan.rehydrate(state));
  }

  async save(loan: Loan): Promise<void> {
    this.store.set(loan.id, loan.toState());
  }

  size(): number {
    return this.store.size;
  }
}

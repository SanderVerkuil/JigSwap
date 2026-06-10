import { DomainEvent, err, ok, Result } from "../../shared-kernel";
import { LibraryError } from "./errors";
import { LoanClosed, LoanOpened } from "./events";
import { CopyId, LoanId, OwnerId } from "./ids";

export type LoanStatus = "open" | "returned" | "recalled";

export interface OpenLoanProps {
  readonly id: LoanId;
  readonly copyId: CopyId;
  readonly lenderId: OwnerId;
  readonly borrowerId: OwnerId;
  readonly expectedReturn?: Date;
  readonly now: Date;
}

export interface LoanState {
  readonly id: LoanId;
  readonly copyId: CopyId;
  readonly lenderId: OwnerId;
  readonly borrowerId: OwnerId;
  readonly status: LoanStatus;
  readonly openedAt: Date;
  readonly expectedReturn?: Date;
  readonly closedAt?: Date;
}

// The Loan aggregate root: an OPEN-ENDED transfer of POSSESSION (not ownership) of one Copy to a
// borrower. Ownership stays with the lender throughout. expectedReturn is advisory only — a loan
// closes when the borrower returns it or the owner recalls it, with no due-date enforcement.
export class Loan {
  private events: DomainEvent[] = [];

  private constructor(private state: LoanState) {}

  get id(): LoanId {
    return this.state.id;
  }
  get copyId(): CopyId {
    return this.state.copyId;
  }
  get lenderId(): OwnerId {
    return this.state.lenderId;
  }
  get borrowerId(): OwnerId {
    return this.state.borrowerId;
  }
  get status(): LoanStatus {
    return this.state.status;
  }

  static open(props: OpenLoanProps): Result<Loan, LibraryError> {
    if (props.lenderId === props.borrowerId) {
      return err(LibraryError.cannotLendToSelf());
    }
    const state: LoanState = {
      id: props.id,
      copyId: props.copyId,
      lenderId: props.lenderId,
      borrowerId: props.borrowerId,
      status: "open",
      openedAt: props.now,
      expectedReturn: props.expectedReturn,
    };
    const loan = new Loan(state);
    loan.record(
      new LoanOpened(
        state.id,
        state.copyId,
        state.lenderId,
        state.borrowerId,
        state.expectedReturn,
        props.now,
      ),
    );
    return ok(loan);
  }

  // The borrower hands the copy back.
  returnByBorrower(by: OwnerId, now: Date): Result<void, LibraryError> {
    if (this.state.status !== "open") return err(LibraryError.loanNotOpen());
    if (by !== this.state.borrowerId) return err(LibraryError.notBorrower());
    return this.close("returned", now);
  }

  // The owner asks for the copy back.
  recallByOwner(by: OwnerId, now: Date): Result<void, LibraryError> {
    if (this.state.status !== "open") return err(LibraryError.loanNotOpen());
    if (by !== this.state.lenderId) return err(LibraryError.notLender());
    return this.close("recalled", now);
  }

  pullEvents(): readonly DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  static rehydrate(state: LoanState): Loan {
    return new Loan(state);
  }

  toState(): LoanState {
    return this.state;
  }

  // --- internals ---

  private close(
    reason: "returned" | "recalled",
    now: Date,
  ): Result<void, LibraryError> {
    this.state = { ...this.state, status: reason, closedAt: now };
    this.record(
      new LoanClosed(
        this.state.id,
        this.state.copyId,
        this.state.lenderId,
        this.state.borrowerId,
        reason,
        now,
      ),
    );
    return ok(undefined);
  }

  private record(event: DomainEvent): void {
    this.events.push(event);
  }
}

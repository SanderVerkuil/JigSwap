import { describe, expect, it } from "vitest";
import {
  DomainEvent,
  toCopyId,
  toLoanId,
  toOwnerId,
} from "../../shared-kernel";

import { Loan } from "./loan";

const loanId = toLoanId("loan1");
const copyId = toCopyId("copy1");
const lender = toOwnerId("alice");
const borrower = toOwnerId("bob");
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-20T10:00:00Z");

const names = (events: readonly DomainEvent[]): string[] =>
  events.map((e) => e.name);

const open = (): Loan => {
  const result = Loan.open({
    id: loanId,
    copyId,
    lenderId: lender,
    borrowerId: borrower,
    now: NOW,
  });
  if (!result.isOk) throw new Error("setup failed");
  return result.value;
};

describe("Loan.open", () => {
  it("opens an open loan and records LoanOpened with both parties", () => {
    const loan = open();
    expect(loan.status).toBe("open");
    const events = loan.pullEvents();
    expect(names(events)).toEqual(["LoanOpened"]);
    expect(events[0]).toMatchObject({
      loanId,
      copyId,
      lenderId: lender,
      borrowerId: borrower,
      occurredAt: NOW,
    });
  });

  it("rejects lending to self", () => {
    const result = Loan.open({
      id: loanId,
      copyId,
      lenderId: lender,
      borrowerId: lender,
      now: NOW,
    });
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("CannotLendToSelf");
  });

  it("carries an optional expected return date", () => {
    const result = Loan.open({
      id: loanId,
      copyId,
      lenderId: lender,
      borrowerId: borrower,
      expectedReturn: LATER,
      now: NOW,
    });
    expect(result.isOk).toBe(true);
    if (result.isOk) expect(result.value.toState().expectedReturn).toBe(LATER);
  });

  it("exposes id, copyId, lenderId and borrowerId through getters", () => {
    const loan = open();
    expect(loan.id).toBe(loanId);
    expect(loan.copyId).toBe(copyId);
    expect(loan.lenderId).toBe(lender);
    expect(loan.borrowerId).toBe(borrower);
  });
});

describe("Loan.returnByBorrower", () => {
  it("the borrower returns an open loan -> returned + LoanClosed(returned)", () => {
    const loan = open();
    loan.pullEvents();
    const result = loan.returnByBorrower(borrower, LATER);
    expect(result.isOk).toBe(true);
    expect(loan.status).toBe("returned");
    const events = loan.pullEvents();
    expect(names(events)).toEqual(["LoanClosed"]);
    expect(events[0]).toMatchObject({ reason: "returned", occurredAt: LATER });
  });

  it("rejects a non-borrower", () => {
    const loan = open();
    const result = loan.returnByBorrower(lender, LATER);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotBorrower");
  });

  it("rejects returning an already-closed loan", () => {
    const loan = open();
    loan.returnByBorrower(borrower, LATER);
    const result = loan.returnByBorrower(borrower, LATER);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("LoanNotOpen");
  });
});

describe("Loan.recallByOwner", () => {
  it("the lender recalls an open loan -> recalled + LoanClosed(recalled)", () => {
    const loan = open();
    loan.pullEvents();
    const result = loan.recallByOwner(lender, LATER);
    expect(result.isOk).toBe(true);
    expect(loan.status).toBe("recalled");
    const events = loan.pullEvents();
    expect(events[0]).toMatchObject({ reason: "recalled" });
  });

  it("rejects a non-lender", () => {
    const loan = open();
    const result = loan.recallByOwner(borrower, LATER);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("NotLender");
  });

  it("rejects recalling an already-closed loan", () => {
    const loan = open();
    loan.recallByOwner(lender, LATER);
    const result = loan.recallByOwner(lender, LATER);
    expect(result.isErr).toBe(true);
    if (result.isErr) expect(result.error.code).toBe("LoanNotOpen");
  });
});

describe("Loan rehydrate / toState round-trip", () => {
  it("rehydrates without re-recording events", () => {
    const original = open();
    const state = original.toState();
    const restored = Loan.rehydrate(state);
    expect(restored.pullEvents()).toHaveLength(0);
    expect(restored.toState()).toEqual(state);
  });
});

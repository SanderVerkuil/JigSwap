import { beforeEach, describe, expect, it } from "vitest";
import {
  err,
  toCopyId,
  toLoanId,
  toOwnerId,
  toPuzzleDefinitionId,
} from "../../../shared-kernel";
import {
  CatalogSnapshot,
  Copy,
  CopyId,
  LibraryError,
  LoanId,
} from "../../domain";
import {
  FixedClock,
  InMemoryCopyRepository,
  InMemoryLoanRepository,
  RecordingEventPublisher,
  SequentialLoanIdGenerator,
} from "../testing";
import { makeOpenLoan } from "./open-loan";
import { makeRecallLoan } from "./recall-loan";
import { makeReturnLoan } from "./return-loan";

const owner = toOwnerId("alice");
const borrower = toOwnerId("bob");
const definitionId = toPuzzleDefinitionId("def1");
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-20T10:00:00Z");

const snapshot = (): CatalogSnapshot =>
  CatalogSnapshot.create({
    puzzleDefinitionId: definitionId,
    title: "Owl",
    pieceCount: 500,
  });

describe("loan use cases", () => {
  let copies: InMemoryCopyRepository;
  let loans: InMemoryLoanRepository;
  let events: RecordingEventPublisher;
  let copyId: CopyId;

  beforeEach(async () => {
    copies = new InMemoryCopyRepository();
    loans = new InMemoryLoanRepository();
    events = new RecordingEventPublisher();
    const acquired = Copy.acquire({
      id: toCopyId("copy-seed"),
      ownerId: owner,
      snapshot: snapshot(),
      condition: "good",
      now: NOW,
    });
    if (!acquired.isOk) throw new Error("setup");
    copyId = acquired.value.id;
    await copies.save(acquired.value);
  });

  const open = () =>
    makeOpenLoan({
      copies,
      loans,
      ids: new SequentialLoanIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    });

  describe("makeOpenLoan", () => {
    it("opens a loan, moves possession to the borrower, keeps ownership", async () => {
      const result = await open()({ copyId, borrowerId: borrower });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual(["LoanOpened", "CopyLentOut"]);
      const copy = await copies.findById(copyId);
      expect(copy?.heldBy).toBe(borrower);
      expect(copy?.ownerId).toBe(owner);
    });

    it("rejects an unknown copy", async () => {
      const result = await open()({
        copyId: toCopyId("ghost"),
        borrowerId: borrower,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
    });

    it("rejects lending a copy to its own owner (CannotLendToSelf)", async () => {
      const result = await open()({ copyId, borrowerId: owner });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CannotLendToSelf");
      expect(events.published).toHaveLength(0);
    });
  });

  describe("closing a loan (return / recall)", () => {
    let loanId: LoanId;

    beforeEach(async () => {
      const opened = await open()({ copyId, borrowerId: borrower });
      if (opened.isOk) loanId = opened.value;
    });

    it("the borrower returns the loan -> possession back to the owner", async () => {
      const result = await makeReturnLoan({
        loans,
        copies,
        events,
        clock: new FixedClock(LATER),
      })({ loanId, actingMemberId: borrower });
      expect(result.isOk).toBe(true);
      expect((await copies.findById(copyId))?.heldBy).toBe(owner);
      expect(events.names()).toEqual(
        expect.arrayContaining(["LoanClosed", "CopyReturnedToOwner"]),
      );
    });

    it("still closes the loan when the copy no longer exists", async () => {
      await copies.remove(copyId);
      const result = await makeReturnLoan({
        loans,
        copies,
        events,
        clock: new FixedClock(LATER),
      })({ loanId, actingMemberId: borrower });
      expect(result.isOk).toBe(true);
      // Exactly the loan close is published — no copy events when the copy is gone.
      expect(events.names()).toEqual([
        "LoanOpened",
        "CopyLentOut",
        "LoanClosed",
      ]);
    });

    it("recall still closes the loan when the copy no longer exists", async () => {
      await copies.remove(copyId);
      const result = await makeRecallLoan({
        loans,
        copies,
        events,
        clock: new FixedClock(LATER),
      })({ loanId, actingMemberId: owner });
      expect(result.isOk).toBe(true);
      expect(events.names()).toEqual([
        "LoanOpened",
        "CopyLentOut",
        "LoanClosed",
      ]);
    });

    it("a non-borrower cannot return", async () => {
      const result = await makeReturnLoan({
        loans,
        copies,
        events,
        clock: new FixedClock(LATER),
      })({ loanId, actingMemberId: owner });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotBorrower");
    });

    it("the owner recalls the loan -> possession back to the owner", async () => {
      const result = await makeRecallLoan({
        loans,
        copies,
        events,
        clock: new FixedClock(LATER),
      })({ loanId, actingMemberId: owner });
      expect(result.isOk).toBe(true);
      expect((await copies.findById(copyId))?.heldBy).toBe(owner);
      expect(events.names()).toEqual(
        expect.arrayContaining(["LoanClosed", "CopyReturnedToOwner"]),
      );
    });

    it("a non-owner cannot recall", async () => {
      const result = await makeRecallLoan({
        loans,
        copies,
        events,
        clock: new FixedClock(LATER),
      })({ loanId, actingMemberId: borrower });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("NotLender");
    });

    it("rejects closing an unknown loan", async () => {
      const result = await makeReturnLoan({
        loans,
        copies,
        events,
        clock: new FixedClock(LATER),
      })({ loanId: toLoanId("ghost"), actingMemberId: borrower });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("LoanNotFound");
    });

    it("rejects recalling an unknown loan", async () => {
      const result = await makeRecallLoan({
        loans,
        copies,
        events,
        clock: new FixedClock(LATER),
      })({ loanId: toLoanId("ghost"), actingMemberId: owner });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("LoanNotFound");
    });

    // returnToOwner returns a Result; both close use cases must propagate a failure rather than
    // silently swallow it and still report ok. Wrap the repo so the loaded copy fails to return.
    const failingReturnCopies = (): InMemoryCopyRepository => {
      const wrapped = copies;
      return {
        ...wrapped,
        findById: async (id: CopyId) => {
          const copy = await wrapped.findById(id);
          if (copy) {
            copy.returnToOwner = () => err(LibraryError.notOwner("return"));
          }
          return copy;
        },
      } as InMemoryCopyRepository;
    };

    it("propagates a returnToOwner failure on return (does not report ok)", async () => {
      const result = await makeReturnLoan({
        loans,
        copies: failingReturnCopies(),
        events,
        clock: new FixedClock(LATER),
      })({ loanId, actingMemberId: borrower });
      expect(result.isErr).toBe(true);
    });

    it("propagates a returnToOwner failure on recall (does not report ok)", async () => {
      const result = await makeRecallLoan({
        loans,
        copies: failingReturnCopies(),
        events,
        clock: new FixedClock(LATER),
      })({ loanId, actingMemberId: owner });
      expect(result.isErr).toBe(true);
    });
  });
});

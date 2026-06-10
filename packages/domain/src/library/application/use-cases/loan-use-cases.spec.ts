import { beforeEach, describe, expect, it } from "vitest";
import { toId } from "../../../shared-kernel";
import {
  CatalogSnapshot,
  Copy,
  CopyId,
  LoanId,
  OwnerId,
  PuzzleDefinitionId,
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

const owner = toId<"OwnerId">("alice") as OwnerId;
const borrower = toId<"OwnerId">("bob") as OwnerId;
const definitionId = toId<"PuzzleDefinitionId">("def1") as PuzzleDefinitionId;
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
      id: toId<"CopyId">("copy-seed") as CopyId,
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
        copyId: toId<"CopyId">("ghost") as CopyId,
        borrowerId: borrower,
      });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("CopyNotFound");
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
      })({ loanId: toId<"LoanId">("ghost") as LoanId, actingMemberId: borrower });
      expect(result.isErr).toBe(true);
      if (result.isErr) expect(result.error.code).toBe("LoanNotFound");
    });
  });
});

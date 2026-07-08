import { describe, expect, it } from "vitest";
import {
  DomainEvent,
  toChangeProposalId,
  toPuzzleDefinitionId,
  toSubmitterId,
} from "../../shared-kernel";
import { ChangeProposalFiled, ChangeProposalRejected } from "./events";
import {
  FileChangeProposalProps,
  PuzzleChangeProposal,
} from "./puzzle-change-proposal";

const id = toChangeProposalId("cp1");
const definitionId = toPuzzleDefinitionId("pd1");
const proposer = toSubmitterId("alice");
const NOW = new Date("2026-07-08T10:00:00Z");
const LATER = new Date("2026-07-09T10:00:00Z");

const names = (events: readonly DomainEvent[]): string[] =>
  events.map((e) => e.name);

const file = (
  overrides: Partial<FileChangeProposalProps> = {},
): PuzzleChangeProposal => {
  const r = PuzzleChangeProposal.file({
    id,
    puzzleDefinitionId: definitionId,
    proposedBy: proposer,
    changes: { title: "Corrected Title" },
    baseline: { title: "Old Title" },
    now: NOW,
    ...overrides,
  });
  if (!r.isOk) throw new Error(`setup failed: ${r.error.message}`);
  return r.value;
};

describe("PuzzleChangeProposal.file", () => {
  it("starts pending and records ChangeProposalFiled with definition + proposer", () => {
    const proposal = file({ comment: "box says 500" });
    expect(proposal.status).toBe("pending");
    expect(proposal.toState().comment).toBe("box says 500");
    const events = proposal.pullEvents();
    expect(names(events)).toEqual(["ChangeProposalFiled"]);
    const filed = events[0] as ChangeProposalFiled;
    expect(filed.changeProposalId).toBe(id);
    expect(filed.puzzleDefinitionId).toBe(definitionId);
    expect(filed.proposedBy).toBe(proposer);
    expect(filed.occurredAt).toBe(NOW);
  });

  it("rejects an empty diff", () => {
    const r = PuzzleChangeProposal.file({
      id,
      puzzleDefinitionId: definitionId,
      proposedBy: proposer,
      changes: {},
      baseline: {},
      now: NOW,
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyProposal");
  });

  it("runs the definition's own invariants: blank title, bad piece count, bad barcode", () => {
    const blank = PuzzleChangeProposal.file({
      id,
      puzzleDefinitionId: definitionId,
      proposedBy: proposer,
      changes: { title: "   " },
      baseline: {},
      now: NOW,
    });
    expect(blank.isErr).toBe(true);
    if (blank.isErr) expect(blank.error.code).toBe("EmptyTitle");

    const pieces = PuzzleChangeProposal.file({
      id,
      puzzleDefinitionId: definitionId,
      proposedBy: proposer,
      changes: { pieceCount: -5 },
      baseline: {},
      now: NOW,
    });
    expect(pieces.isErr).toBe(true);
    if (pieces.isErr) expect(pieces.error.code).toBe("InvalidPieceCount");

    const barcode = PuzzleChangeProposal.file({
      id,
      puzzleDefinitionId: definitionId,
      proposedBy: proposer,
      changes: { barcodes: { ean: "not-an-ean" } },
      baseline: {},
      now: NOW,
    });
    expect(barcode.isErr).toBe(true);
    if (barcode.isErr) expect(barcode.error.code).toBe("InvalidBarcode");
  });
});

describe("edit", () => {
  it("replaces changes, baseline and comment in place on a pending proposal", () => {
    const proposal = file();
    proposal.pullEvents();
    const r = proposal.edit(
      { pieceCount: 500 },
      { pieceCount: 1000 },
      "recount",
      LATER,
    );
    expect(r.isOk).toBe(true);
    const state = proposal.toState();
    expect(state.changes).toEqual({ pieceCount: 500 });
    expect(state.baseline).toEqual({ pieceCount: 1000 });
    expect(state.comment).toBe("recount");
    expect(state.updatedAt).toBe(LATER);
    expect(names(proposal.pullEvents())).toEqual(["ChangeProposalEdited"]);
  });

  it("re-validates the new diff (empty diff rejected)", () => {
    const proposal = file();
    const r = proposal.edit({}, {}, undefined, LATER);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyProposal");
  });

  it("cannot edit a decided or withdrawn proposal", () => {
    const approved = file();
    approved.approve(NOW);
    const r1 = approved.edit({ title: "X" }, {}, undefined, LATER);
    expect(r1.isErr).toBe(true);
    if (r1.isErr) expect(r1.error.code).toBe("ProposalNotPending");

    const withdrawn = file();
    withdrawn.withdraw(NOW);
    const r2 = withdrawn.edit({ title: "X" }, {}, undefined, LATER);
    expect(r2.isErr).toBe(true);
    if (r2.isErr) expect(r2.error.code).toBe("ProposalNotPending");
  });
});

describe("decision lifecycle", () => {
  it("approve moves pending → approved, stamps decidedAt, records ChangeProposalApproved", () => {
    const proposal = file();
    proposal.pullEvents();
    const r = proposal.approve(LATER);
    expect(r.isOk).toBe(true);
    expect(proposal.status).toBe("approved");
    expect(proposal.toState().decidedAt).toBe(LATER);
    expect(names(proposal.pullEvents())).toEqual(["ChangeProposalApproved"]);
  });

  it("reject stores the reason, stamps decidedAt, records ChangeProposalRejected carrying it", () => {
    const proposal = file();
    proposal.pullEvents();
    const r = proposal.reject("duplicate of an existing fix", LATER);
    expect(r.isOk).toBe(true);
    expect(proposal.status).toBe("rejected");
    expect(proposal.toState().rejectionReason).toBe(
      "duplicate of an existing fix",
    );
    expect(proposal.toState().decidedAt).toBe(LATER);
    const events = proposal.pullEvents();
    expect(names(events)).toEqual(["ChangeProposalRejected"]);
    expect((events[0] as ChangeProposalRejected).reason).toBe(
      "duplicate of an existing fix",
    );
  });

  it("withdraw moves pending → withdrawn without decidedAt", () => {
    const proposal = file();
    proposal.pullEvents();
    const r = proposal.withdraw(LATER);
    expect(r.isOk).toBe(true);
    expect(proposal.status).toBe("withdrawn");
    expect(proposal.toState().decidedAt).toBeUndefined();
    expect(names(proposal.pullEvents())).toEqual(["ChangeProposalWithdrawn"]);
  });

  it.each([
    ["approve", (p: PuzzleChangeProposal) => p.approve(LATER)],
    ["reject", (p: PuzzleChangeProposal) => p.reject(undefined, LATER)],
    ["withdraw", (p: PuzzleChangeProposal) => p.withdraw(LATER)],
  ])("%s is illegal on an already-decided proposal", (_label, act) => {
    const proposal = file();
    proposal.approve(NOW);
    const r = act(proposal);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("IllegalProposalTransition");
  });
});

describe("rehydrate/toState round-trip", () => {
  it("preserves every field", () => {
    const proposal = file({ comment: "why" });
    const state = proposal.toState();
    const back = PuzzleChangeProposal.rehydrate(state);
    expect(back.toState()).toEqual(state);
    expect(back.pullEvents()).toEqual([]);
  });
});

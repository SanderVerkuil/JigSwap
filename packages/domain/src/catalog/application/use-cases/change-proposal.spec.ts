import { beforeEach, describe, expect, it } from "vitest";
import {
  toChangeProposalId,
  toPuzzleDefinitionId,
  toSubmitterId,
} from "../../../shared-kernel";
import { PuzzleChangeProposal, PuzzleDefinition } from "../../domain";
import {
  FixedClock,
  InMemoryChangeProposalRepository,
  InMemoryPuzzleDefinitionRepository,
  RecordingEventPublisher,
  SequentialIdGenerator,
} from "../testing";
import { makeApproveChangeProposal } from "./approve-change-proposal";
import { makeEditChangeProposal } from "./edit-change-proposal";
import { makeFileChangeProposal } from "./file-change-proposal";
import { makeRejectChangeProposal } from "./reject-change-proposal";
import { makeWithdrawChangeProposal } from "./withdraw-change-proposal";

const NOW = new Date("2026-07-08T10:00:00Z");
const alice = toSubmitterId("alice");
const bob = toSubmitterId("bob");

// Shared world for every proposal use-case spec: repositories + one approved definition.
const definitionId = toPuzzleDefinitionId("pd-existing");

let definitions: InMemoryPuzzleDefinitionRepository;
let proposals: InMemoryChangeProposalRepository;
let events: RecordingEventPublisher;
let clock: FixedClock;
let ids: SequentialIdGenerator;

const seedDefinition = async (status: "pending" | "approved" = "approved") => {
  const r = PuzzleDefinition.submit({
    id: definitionId,
    title: "Starry Night",
    pieceCount: 1000,
    submittedBy: bob,
    now: NOW,
  });
  if (!r.isOk) throw new Error("seed failed");
  if (status === "approved") {
    const approved = r.value.approve(NOW);
    if (approved.isErr) throw new Error("seed approve failed");
  }
  r.value.pullEvents();
  await definitions.save(r.value);
};

const deps = () => ({ proposals, definitions, ids, events, clock });

beforeEach(() => {
  definitions = new InMemoryPuzzleDefinitionRepository();
  proposals = new InMemoryChangeProposalRepository();
  events = new RecordingEventPublisher();
  clock = new FixedClock(NOW);
  ids = new SequentialIdGenerator();
});

describe("makeFileChangeProposal", () => {
  it("files a pending proposal with a server-derived baseline and publishes ChangeProposalFiled", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());

    const r = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "Corrected", pieceCount: 500 },
      comment: "box says 500",
    });

    expect(r.isOk).toBe(true);
    if (!r.isOk) return;
    const saved = await proposals.findById(r.value);
    expect(saved).not.toBeNull();
    const state = saved!.toState();
    expect(state.status).toBe("pending");
    expect(state.changes).toEqual({ title: "Corrected", pieceCount: 500 });
    // Baseline snapshots the CURRENT values of exactly the changed fields.
    expect(state.baseline).toEqual({ title: "Starry Night", pieceCount: 1000 });
    expect(state.comment).toBe("box says 500");
    expect(events.names()).toEqual(["ChangeProposalFiled"]);
  });

  it("rejects a proposal against a missing definition", async () => {
    const file = makeFileChangeProposal(deps());
    const r = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("PuzzleDefinitionNotFound");
  });

  it("rejects a proposal against a non-approved definition", async () => {
    await seedDefinition("pending");
    const file = makeFileChangeProposal(deps());
    const r = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("DefinitionNotProposable");
  });

  it("enforces one OPEN proposal per (definition, proposer)", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const first = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    expect(first.isOk).toBe(true);

    const second = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { brand: "Ravensburger" },
    });
    expect(second.isErr).toBe(true);
    if (second.isErr)
      expect(second.error.code).toBe("OpenProposalAlreadyExists");

    // A DIFFERENT member may file concurrently.
    const other = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: bob,
      changes: { brand: "Ravensburger" },
    });
    expect(other.isOk).toBe(true);
  });

  it("propagates aggregate validation failures without saving", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const r = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: {},
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyProposal");
    expect(proposals.size()).toBe(0);
    expect(events.published).toEqual([]);
  });

  it("snapshots the grouped barcode baseline from the definition's flat fields", async () => {
    const r = PuzzleDefinition.submit({
      id: toPuzzleDefinitionId("pd-barcoded"),
      title: "Barcoded",
      pieceCount: 500,
      submittedBy: bob,
      now: NOW,
      barcodes: { ean: "4006381333931", modelNumber: "RV-1" },
    });
    if (!r.isOk) throw new Error("seed failed");
    r.value.approve(NOW);
    r.value.pullEvents();
    await definitions.save(r.value);

    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: toPuzzleDefinitionId("pd-barcoded"),
      proposedBy: alice,
      changes: { barcodes: { ean: "4006381333931", upc: "036000291452" } },
    });

    expect(filed.isOk).toBe(true);
    if (!filed.isOk) return;
    const state = (await proposals.findById(filed.value))!.toState();
    expect(state.baseline).toEqual({
      barcodes: { ean: "4006381333931", upc: undefined, modelNumber: "RV-1" },
    });
  });
});

describe("makeEditChangeProposal", () => {
  it("replaces changes/comment and re-derives the baseline against the CURRENT definition", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "First idea" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    events.published.length = 0;

    const edit = makeEditChangeProposal(deps());
    const r = await edit({
      changeProposalId: filed.value,
      changes: { pieceCount: 500 },
      comment: "recount",
    });

    expect(r.isOk).toBe(true);
    const state = (await proposals.findById(filed.value))!.toState();
    expect(state.changes).toEqual({ pieceCount: 500 });
    expect(state.baseline).toEqual({ pieceCount: 1000 });
    expect(state.comment).toBe("recount");
    expect(events.names()).toEqual(["ChangeProposalEdited"]);
  });

  it("fails with ChangeProposalNotFound for an unknown id", async () => {
    await seedDefinition();
    const edit = makeEditChangeProposal(deps());
    const r = await edit({
      changeProposalId: ids.nextChangeProposalId(),
      changes: { title: "X" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("ChangeProposalNotFound");
  });

  it("propagates ProposalNotPending from the aggregate", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    const withdraw = makeWithdrawChangeProposal(deps());
    await withdraw({ changeProposalId: filed.value });

    const edit = makeEditChangeProposal(deps());
    const r = await edit({
      changeProposalId: filed.value,
      changes: { title: "Y" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("ProposalNotPending");
  });

  it("fails with PuzzleDefinitionNotFound when the target definition has disappeared", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "First idea" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    // Sabotage: the definition disappears between filing and editing.
    definitions = new InMemoryPuzzleDefinitionRepository();

    const edit = makeEditChangeProposal(deps());
    const r = await edit({
      changeProposalId: filed.value,
      changes: { pieceCount: 500 },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("PuzzleDefinitionNotFound");
  });
});

describe("makeWithdrawChangeProposal", () => {
  it("moves a pending proposal to withdrawn and publishes ChangeProposalWithdrawn", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    events.published.length = 0;

    const withdraw = makeWithdrawChangeProposal(deps());
    const r = await withdraw({ changeProposalId: filed.value });

    expect(r.isOk).toBe(true);
    expect((await proposals.findById(filed.value))!.status).toBe("withdrawn");
    expect(events.names()).toEqual(["ChangeProposalWithdrawn"]);
  });

  it("after withdrawing, the same member may file a fresh proposal", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    const withdraw = makeWithdrawChangeProposal(deps());
    await withdraw({ changeProposalId: filed.value });

    const again = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "Y" },
    });
    expect(again.isOk).toBe(true);
  });

  it("fails with ChangeProposalNotFound for an unknown id", async () => {
    const withdraw = makeWithdrawChangeProposal(deps());
    const r = await withdraw({ changeProposalId: ids.nextChangeProposalId() });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("ChangeProposalNotFound");
  });

  it("cannot withdraw a proposal twice, and publishes nothing on the second attempt", async () => {
    await seedDefinition();
    const file = makeFileChangeProposal(deps());
    const filed = await file({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "X" },
    });
    if (!filed.isOk) throw new Error("setup failed");

    const withdraw = makeWithdrawChangeProposal(deps());
    await withdraw({ changeProposalId: filed.value });
    events.published.length = 0;

    const again = await withdraw({ changeProposalId: filed.value });
    expect(again.isErr).toBe(true);
    if (again.isErr) expect(again.error.code).toBe("IllegalProposalTransition");
    expect(events.published).toEqual([]);
  });
});

describe("makeApproveChangeProposal", () => {
  const fileOne = async (
    changes: Parameters<
      ReturnType<typeof makeFileChangeProposal>
    >[0]["changes"],
  ) => {
    const filed = await makeFileChangeProposal(deps())({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes,
    });
    if (!filed.isOk) throw new Error("setup failed");
    events.published.length = 0;
    return filed.value;
  };

  it("approves the proposal AND applies the patch to the definition, publishing both batches", async () => {
    await seedDefinition();
    const proposalId = await fileOne({ title: "Corrected", pieceCount: 500 });

    const approve = makeApproveChangeProposal(deps());
    const r = await approve({ changeProposalId: proposalId });

    expect(r.isOk).toBe(true);
    const proposal = (await proposals.findById(proposalId))!;
    expect(proposal.status).toBe("approved");
    const definition = (await definitions.findById(definitionId))!.toState();
    expect(definition.title).toBe("Corrected");
    expect(definition.pieceCount).toBe(500);
    // Both aggregates' events land in one publish sequence: proposal first, then definition.
    expect(events.names()).toEqual([
      "ChangeProposalApproved",
      "PuzzleDefinitionUpdated",
    ]);
  });

  it("fails with ChangeProposalNotFound for an unknown id", async () => {
    await seedDefinition();
    const approve = makeApproveChangeProposal(deps());
    const r = await approve({ changeProposalId: ids.nextChangeProposalId() });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("ChangeProposalNotFound");
  });

  it("cannot approve twice — and does not double-apply the patch", async () => {
    await seedDefinition();
    const proposalId = await fileOne({ title: "Corrected" });
    const approve = makeApproveChangeProposal(deps());
    await approve({ changeProposalId: proposalId });

    const again = await approve({ changeProposalId: proposalId });
    expect(again.isErr).toBe(true);
    if (again.isErr) expect(again.error.code).toBe("IllegalProposalTransition");
  });

  it("saves NOTHING when applying the patch fails on the definition", async () => {
    await seedDefinition();
    const proposalId = await fileOne({ title: "Corrected" });
    // Sabotage: the definition disappears between filing and approval.
    definitions = new InMemoryPuzzleDefinitionRepository();

    const approve = makeApproveChangeProposal(deps());
    const r = await approve({ changeProposalId: proposalId });

    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("PuzzleDefinitionNotFound");
    // The proposal is untouched (still pending) and nothing was published.
    expect((await proposals.findById(proposalId))!.status).toBe("pending");
    expect(events.published).toEqual([]);
  });

  it("saves NOTHING when the definition rejects the patch (invalid stored proposal)", async () => {
    await seedDefinition();
    // Bypass file()'s own validation to get an invalid diff into storage — rehydrate a
    // proposal directly rather than going through PuzzleChangeProposal.file(), so
    // definition.update() is the one that fails, not the proposal aggregate.
    const badProposal = PuzzleChangeProposal.rehydrate({
      id: toChangeProposalId("cp-bad"),
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      status: "pending",
      changes: { title: "   " },
      baseline: {},
      createdAt: NOW,
      updatedAt: NOW,
    });
    await proposals.save(badProposal);

    const approve = makeApproveChangeProposal(deps());
    const r = await approve({ changeProposalId: badProposal.id });

    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyTitle");
    // The proposal is untouched (still pending), the definition untouched, nothing published.
    expect((await proposals.findById(badProposal.id))!.status).toBe("pending");
    expect((await definitions.findById(definitionId))!.toState().title).toBe(
      "Starry Night",
    );
    expect(events.published).toEqual([]);
  });
});

describe("makeRejectChangeProposal", () => {
  it("rejects with a reason, leaves the definition untouched, publishes ChangeProposalRejected", async () => {
    await seedDefinition();
    const filed = await makeFileChangeProposal(deps())({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "Wrong idea" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    events.published.length = 0;

    const reject = makeRejectChangeProposal(deps());
    const r = await reject({
      changeProposalId: filed.value,
      reason: "title matches the box",
    });

    expect(r.isOk).toBe(true);
    const state = (await proposals.findById(filed.value))!.toState();
    expect(state.status).toBe("rejected");
    expect(state.rejectionReason).toBe("title matches the box");
    expect((await definitions.findById(definitionId))!.toState().title).toBe(
      "Starry Night",
    );
    expect(events.names()).toEqual(["ChangeProposalRejected"]);
  });

  it("fails with ChangeProposalNotFound for an unknown id", async () => {
    const reject = makeRejectChangeProposal(deps());
    const r = await reject({ changeProposalId: ids.nextChangeProposalId() });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("ChangeProposalNotFound");
  });

  it("cannot reject an already-withdrawn proposal", async () => {
    await seedDefinition();
    const filed = await makeFileChangeProposal(deps())({
      puzzleDefinitionId: definitionId,
      proposedBy: alice,
      changes: { title: "Wrong idea" },
    });
    if (!filed.isOk) throw new Error("setup failed");
    const withdraw = makeWithdrawChangeProposal(deps());
    await withdraw({ changeProposalId: filed.value });

    const reject = makeRejectChangeProposal(deps());
    const r = await reject({ changeProposalId: filed.value });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("IllegalProposalTransition");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { toPuzzleDefinitionId, toSubmitterId } from "../../../shared-kernel";
import { PuzzleDefinition } from "../../domain";
import {
  FixedClock,
  InMemoryChangeProposalRepository,
  InMemoryPuzzleDefinitionRepository,
  RecordingEventPublisher,
  SequentialIdGenerator,
} from "../testing";
import { makeFileChangeProposal } from "./file-change-proposal";

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
});

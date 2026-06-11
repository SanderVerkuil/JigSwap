import { beforeEach, describe, expect, it, vi } from "vitest";
import { toPuzzleDefinitionId, toSubmitterId } from "../../../shared-kernel";

import {
  FixedClock,
  InMemoryPuzzleDefinitionRepository,
  RecordingEventPublisher,
  SequentialIdGenerator,
} from "../testing";
import { makeApprovePuzzleDefinition } from "./approve-puzzle-definition";
import { makeRejectPuzzleDefinition } from "./reject-puzzle-definition";
import { makeSubmitPuzzleDefinition } from "./submit-puzzle-definition";
import { makeUpdatePuzzleDefinition } from "./update-puzzle-definition";

const submitter = toSubmitterId("alice");
const NOW = new Date("2026-06-08T10:00:00Z");

describe("Catalog PuzzleDefinition use cases", () => {
  let repo: InMemoryPuzzleDefinitionRepository;
  let events: RecordingEventPublisher;
  let deps: {
    definitions: InMemoryPuzzleDefinitionRepository;
    ids: SequentialIdGenerator;
    events: RecordingEventPublisher;
    clock: FixedClock;
  };

  beforeEach(() => {
    repo = new InMemoryPuzzleDefinitionRepository();
    events = new RecordingEventPublisher();
    deps = {
      definitions: repo,
      ids: new SequentialIdGenerator(),
      events,
      clock: new FixedClock(NOW),
    };
  });

  const submitOk = async (barcodes?: { ean?: string; upc?: string }) => {
    const submit = makeSubmitPuzzleDefinition(deps);
    const r = await submit({
      title: "Starry Night",
      pieceCount: 1000,
      submittedBy: submitter,
      barcodes,
    });
    if (!r.isOk) throw new Error(`submit failed: ${r.error.code}`);
    return r.value;
  };

  it("submits a definition, saving state and publishing PuzzleDefinitionSubmitted", async () => {
    const id = await submitOk();
    expect(repo.size()).toBe(1);
    expect(events.names()).toEqual(["PuzzleDefinitionSubmitted"]);
    expect(id).toBe(toPuzzleDefinitionId("pd-1"));
  });

  it("rejects a duplicate barcode via the repository (DuplicateBarcode)", async () => {
    await submitOk({ ean: "4006381333931" });
    const submit = makeSubmitPuzzleDefinition(deps);

    const second = await submit({
      title: "Another",
      pieceCount: 500,
      submittedBy: submitter,
      barcodes: { ean: "4006381333931" },
    });
    expect(second.isErr).toBe(true);
    if (second.isErr) expect(second.error.code).toBe("DuplicateBarcode");
    expect(repo.size()).toBe(1); // no second definition written
  });

  // Only PRESENT barcodes are checked for uniqueness: absent (undefined) identifiers are
  // filtered out of the candidate list, so the repository is queried solely with the EAN —
  // never with `undefined` (kills the dropped `.filter`).
  it("queries uniqueness only for the supplied barcodes, never for absent ones", async () => {
    const lookup = vi.spyOn(repo, "findByBarcode");
    const submit = makeSubmitPuzzleDefinition(deps);
    const r = await submit({
      title: "Filtered",
      pieceCount: 1000,
      submittedBy: submitter,
      barcodes: { ean: "4006381333931" }, // upc / modelNumber absent
    });
    expect(r.isOk).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("4006381333931");
  });

  it("checks every distinct supplied barcode for a duplicate (UPC clash too)", async () => {
    await submitOk({ ean: "4006381333931" });
    const submit = makeSubmitPuzzleDefinition(deps);
    // Reuse the same EAN under a different title: the EAN candidate must trigger the clash.
    const dup = await submit({
      title: "UPC clash",
      pieceCount: 500,
      submittedBy: submitter,
      barcodes: { upc: "036000291452", ean: "4006381333931" },
    });
    expect(dup.isErr).toBe(true);
    if (dup.isErr) expect(dup.error.code).toBe("DuplicateBarcode");
  });

  it("delegates barcode-format validation to the aggregate", async () => {
    const submit = makeSubmitPuzzleDefinition(deps);
    const r = await submit({
      title: "Bad",
      pieceCount: 100,
      submittedBy: submitter,
      barcodes: { ean: "nope" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("InvalidBarcode");
    expect(events.published).toHaveLength(0);
  });

  it("approves a stored definition and publishes PuzzleDefinitionApproved", async () => {
    const id = await submitOk();
    events.published.length = 0;
    const approve = makeApprovePuzzleDefinition(deps);
    const r = await approve({ puzzleDefinitionId: id });
    expect(r.isOk).toBe(true);
    expect(events.names()).toEqual(["PuzzleDefinitionApproved"]);
  });

  it("rejects approval of an unknown definition (PuzzleDefinitionNotFound)", async () => {
    const approve = makeApprovePuzzleDefinition(deps);
    const r = await approve({
      puzzleDefinitionId: toPuzzleDefinitionId("missing"),
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("PuzzleDefinitionNotFound");
  });

  it("surfaces the aggregate's illegal-transition on re-approval", async () => {
    const id = await submitOk();
    const approve = makeApprovePuzzleDefinition(deps);
    await approve({ puzzleDefinitionId: id });
    const again = await approve({ puzzleDefinitionId: id });
    expect(again.isErr).toBe(true);
    if (again.isErr) expect(again.error.code).toBe("IllegalApprovalTransition");
  });

  it("rejects a definition and publishes PuzzleDefinitionRejected", async () => {
    const id = await submitOk();
    events.published.length = 0;
    const reject = makeRejectPuzzleDefinition(deps);
    const r = await reject({ puzzleDefinitionId: id });
    expect(r.isOk).toBe(true);
    expect(events.names()).toEqual(["PuzzleDefinitionRejected"]);
  });

  it("updates a definition and publishes PuzzleDefinitionUpdated", async () => {
    const id = await submitOk();
    events.published.length = 0;
    const update = makeUpdatePuzzleDefinition(deps);
    const r = await update({
      puzzleDefinitionId: id,
      changes: { brand: "Ravensburger" },
    });
    expect(r.isOk).toBe(true);
    expect(events.names()).toEqual(["PuzzleDefinitionUpdated"]);
    const stored = await repo.findById(id);
    expect(stored?.toState().brand).toBe("Ravensburger");
  });
});

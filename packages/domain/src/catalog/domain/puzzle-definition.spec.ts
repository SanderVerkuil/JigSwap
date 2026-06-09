import { describe, expect, it } from "vitest";
import { DomainEvent, toId } from "../../shared-kernel";
import { PuzzleDefinitionSubmitted } from "./events";
import { PuzzleDefinitionId, SubmitterId } from "./ids";
import { PuzzleDefinition, SubmitPuzzleDefinitionProps } from "./puzzle-definition";

const id = toId<"PuzzleDefinitionId">("pd1") as PuzzleDefinitionId;
const submitter = toId<"SubmitterId">("alice") as SubmitterId;
const NOW = new Date("2026-06-08T10:00:00Z");
const LATER = new Date("2026-06-09T10:00:00Z");

const names = (events: readonly DomainEvent[]): string[] => events.map((e) => e.name);

const submit = (
  overrides: Partial<SubmitPuzzleDefinitionProps> = {},
): PuzzleDefinition => {
  const r = PuzzleDefinition.submit({
    id,
    title: "Starry Night",
    pieceCount: 1000,
    submittedBy: submitter,
    now: NOW,
    ...overrides,
  });
  if (!r.isOk) throw new Error(`setup failed: ${r.error.message}`);
  return r.value;
};

describe("PuzzleDefinition.submit", () => {
  it("starts pending and records PuzzleDefinitionSubmitted with the submitter", () => {
    const def = submit();
    expect(def.status).toBe("pending");
    const events = def.pullEvents();
    expect(names(events)).toEqual(["PuzzleDefinitionSubmitted"]);
    const submitted = events[0] as PuzzleDefinitionSubmitted;
    expect(submitted.submittedBy).toBe(submitter);
    expect(submitted.occurredAt).toBe(NOW);
  });

  it("trims the title and rejects a blank one", () => {
    expect(submit({ title: "  Trimmed  " }).toState().title).toBe("Trimmed");
    const r = PuzzleDefinition.submit({
      id,
      title: "   ",
      pieceCount: 1000,
      submittedBy: submitter,
      now: NOW,
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("EmptyTitle");
  });

  it.each([0, -5, 3.5])("rejects a non-positive-integer piece count (%s)", (value) => {
    const r = PuzzleDefinition.submit({
      id,
      title: "Ok",
      pieceCount: value,
      submittedBy: submitter,
      now: NOW,
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("InvalidPieceCount");
  });

  it("rejects a malformed barcode", () => {
    const r = PuzzleDefinition.submit({
      id,
      title: "Ok",
      pieceCount: 500,
      submittedBy: submitter,
      now: NOW,
      barcodes: { ean: "not-an-ean" },
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("InvalidBarcode");
  });

  it("flattens validated barcodes into state columns", () => {
    const state = submit({
      barcodes: { ean: "4006381333931", modelNumber: "RV-1" },
    }).toState();
    expect(state.ean).toBe("4006381333931");
    expect(state.modelNumber).toBe("RV-1");
    expect(state.upc).toBeUndefined();
  });
});

describe("approval lifecycle", () => {
  it("approves a pending definition, recording PuzzleDefinitionApproved", () => {
    const def = submit();
    def.pullEvents();
    const r = def.approve(LATER);
    expect(r.isOk).toBe(true);
    expect(def.status).toBe("approved");
    expect(names(def.pullEvents())).toEqual(["PuzzleDefinitionApproved"]);
    expect(def.toState().updatedAt).toBe(LATER);
  });

  it("rejects a pending definition, recording PuzzleDefinitionRejected", () => {
    const def = submit();
    def.pullEvents();
    const r = def.reject(LATER);
    expect(r.isOk).toBe(true);
    expect(def.status).toBe("rejected");
    expect(names(def.pullEvents())).toEqual(["PuzzleDefinitionRejected"]);
  });

  it("cannot approve an already-approved definition (illegal transition)", () => {
    const def = submit();
    def.approve(NOW);
    const r = def.approve(LATER);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.code).toBe("IllegalApprovalTransition");
  });

  it("cannot reject an approved definition, nor approve a rejected one", () => {
    const approved = submit();
    approved.approve(NOW);
    expect(approved.reject(LATER).isErr).toBe(true);

    const rejected = submit();
    rejected.reject(NOW);
    expect(rejected.approve(LATER).isErr).toBe(true);
  });
});

describe("update", () => {
  it("patches descriptive fields and records PuzzleDefinitionUpdated", () => {
    const def = submit();
    def.pullEvents();
    const r = def.update({ brand: "Ravensburger", tags: ["art", "van-gogh"] }, LATER);
    expect(r.isOk).toBe(true);
    expect(def.toState().brand).toBe("Ravensburger");
    expect(def.toState().tags).toEqual(["art", "van-gogh"]);
    expect(names(def.pullEvents())).toEqual(["PuzzleDefinitionUpdated"]);
  });

  it("re-validates patched title, pieceCount and barcodes", () => {
    const def = submit();
    expect(def.update({ title: "  " }, LATER).isErr).toBe(true);
    expect(def.update({ pieceCount: -1 }, LATER).isErr).toBe(true);
    expect(def.update({ barcodes: { upc: "bad" } }, LATER).isErr).toBe(true);
  });

  it("leaves approval status untouched", () => {
    const def = submit();
    def.approve(NOW);
    def.update({ brand: "X" }, LATER);
    expect(def.status).toBe("approved");
  });
});

describe("searchableText (derived projection)", () => {
  it("joins title, brand, artist, series and tags, skipping empties", () => {
    const def = submit({
      title: "Starry Night",
      brand: "Ravensburger",
      artist: "Van Gogh",
      series: "Masterpieces",
      tags: ["art", "night"],
    });
    expect(def.searchableText()).toBe(
      "Starry Night Ravensburger Van Gogh Masterpieces art night",
    );
  });

  it("reflects updates and is never part of persisted state", () => {
    const def = submit({ title: "A", tags: [] });
    expect(def.searchableText()).toBe("A");
    def.update({ brand: "B" }, LATER);
    expect(def.searchableText()).toBe("A B");
    expect("searchableText" in def.toState()).toBe(false);
  });
});

describe("rehydrate / toState round-trip", () => {
  it("rehydrates without re-recording events", () => {
    const original = submit({ barcodes: { ean: "4006381333931" } });
    const state = original.toState();
    const restored = PuzzleDefinition.rehydrate(state);
    expect(restored.pullEvents()).toHaveLength(0);
    expect(restored.toState()).toEqual(state);
    expect(restored.status).toBe("pending");
  });

  it("a rehydrated definition can still be approved", () => {
    const restored = PuzzleDefinition.rehydrate(submit().toState());
    expect(restored.approve(LATER).isOk).toBe(true);
    expect(restored.status).toBe("approved");
  });
});

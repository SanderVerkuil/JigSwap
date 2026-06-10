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

  it("trims and applies a valid title change", () => {
    const def = submit({ title: "Old" });
    const r = def.update({ title: "  New Title  " }, LATER);
    expect(r.isOk).toBe(true);
    expect(def.toState().title).toBe("New Title");
  });

  it("re-flattens validated barcodes into the state columns on update", () => {
    const def = submit();
    const r = def.update(
      { barcodes: { ean: "4006381333931", modelNumber: "  RV-9  " } },
      LATER,
    );
    expect(r.isOk).toBe(true);
    const state = def.toState();
    expect(state.ean).toBe("4006381333931");
    expect(state.modelNumber).toBe("RV-9");
    expect(state.upc).toBeUndefined();
  });

  // Updating with ONLY a UPC must clear ean/modelNumber to undefined via optional chaining
  // (`validated.value.ean?.value`): replacing the whole barcode grouping, not merging it.
  it("replaces the whole barcode grouping, clearing absent identifiers to undefined", () => {
    const def = submit({
      barcodes: { ean: "4006381333931", modelNumber: "RV-1" },
    });
    const r = def.update({ barcodes: { upc: "036000291452" } }, LATER);
    expect(r.isOk).toBe(true);
    const state = def.toState();
    expect(state.upc).toBe("036000291452");
    expect(state.ean).toBeUndefined();
    expect(state.modelNumber).toBeUndefined();
  });

  // Omitting `barcodes` entirely must preserve the previously stored identifiers
  // (the `barcodeFields` default object), not wipe them.
  it("preserves stored barcodes when an update omits the barcodes field", () => {
    const def = submit({ barcodes: { ean: "4006381333931" } });
    def.update({ brand: "Anything" }, LATER);
    expect(def.toState().ean).toBe("4006381333931");
  });

  it("applies a valid pieceCount change", () => {
    const def = submit({ pieceCount: 100 });
    expect(def.update({ pieceCount: 2000 }, LATER).isOk).toBe(true);
    expect(def.toState().pieceCount).toBe(2000);
  });

  // Each descriptive field patches independently via `changes.X ?? state.X`; setting one from
  // an UNSET baseline distinguishes `??` (keeps the new value) from `&&` (would drop it).
  it("sets each previously-unset descriptive field from its change", () => {
    const def = submit({
      title: "Base",
      tags: [],
      // description / artist / series / dimensions / shape / difficulty / category / image
      // are all left undefined so the ?? coalescing is exercised on an unset baseline.
    });
    def.update(
      {
        description: "A scene",
        artist: "An Artist",
        series: "A Series",
        image: "ref://img",
        dimensions: { width: 50, height: 70, unit: "cm" },
        shape: "round",
        difficulty: "hard",
        category: toId<"CatalogCategoryId">("cat1"),
      },
      LATER,
    );
    const state = def.toState();
    expect(state.description).toBe("A scene");
    expect(state.artist).toBe("An Artist");
    expect(state.series).toBe("A Series");
    expect(state.image).toBe("ref://img");
    expect(state.dimensions).toEqual({ width: 50, height: 70, unit: "cm" });
    expect(state.shape).toBe("round");
    expect(state.difficulty).toBe("hard");
    expect(state.category).toBe("cat1");
  });

  it("preserves existing fields when a change omits them", () => {
    const def = submit({ brand: "Keep", artist: "Keep Artist" });
    def.update({ description: "added" }, LATER);
    const state = def.toState();
    expect(state.brand).toBe("Keep");
    expect(state.artist).toBe("Keep Artist");
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

  it("omits the tags segment entirely when no tags are set", () => {
    // tags left undefined exercises the `this.state.tags ?? []` fallback in searchableText.
    const def = submit({ title: "Solo", brand: "Brand" });
    expect(def.searchableText()).toBe("Solo Brand");
  });

  // An empty-string field is filtered out (length > 0, not >= 0): no stray separators appear.
  it("excludes present-but-empty fields rather than emitting blank gaps", () => {
    const def = submit({
      title: "Title",
      brand: "",
      artist: "Artist",
      series: "",
      tags: ["", "tag"],
    });
    expect(def.searchableText()).toBe("Title Artist tag");
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

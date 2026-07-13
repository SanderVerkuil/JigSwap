import { describe, expect, it } from "vitest";
import {
  toCatalogCategoryId,
  toPuzzleDefinitionId,
  toSubmitterId,
} from "../../../shared-kernel";
import { PuzzleDefinition, PuzzleDefinitionChanges } from "../../domain";
import { baselineFor } from "./proposal-baseline";

const NOW = new Date("2026-07-08T10:00:00Z");
const submitter = toSubmitterId("bob");

// A definition with EVERY descriptive field populated, so baselineFor has a real current
// value to snapshot for each one.
const fullDefinition = (): PuzzleDefinition => {
  const r = PuzzleDefinition.submit({
    id: toPuzzleDefinitionId("pd-full"),
    title: "Starry Night",
    pieceCount: 1000,
    submittedBy: submitter,
    now: NOW,
    description: "A swirling night sky over a village.",
    brand: "Ravensburger",
    publisher: "Jumbo",
    artist: "Van Gogh",
    series: "Masterpieces",
    barcodes: {
      ean: "4006381333931",
      upc: "036000291452",
      modelNumber: "RV-1",
    },
    dimensions: { width: 50, height: 70, unit: "cm" },
    shape: "rectangular",
    difficulty: "hard",
    category: toCatalogCategoryId("cc-art"),
    tags: ["a", "b"],
    image: "storage://image-1",
  });
  if (!r.isOk) throw new Error(`setup failed: ${r.error.message}`);
  return r.value;
};

// Touches every field the aggregate can diff. The actual new values are irrelevant to
// baselineFor — it only cares whether each field is `!== undefined` in the diff.
const ALL_FIELD_CHANGES: PuzzleDefinitionChanges = {
  title: "New Title",
  description: "New description",
  brand: "New Brand",
  publisher: "New Publisher",
  pieceCount: 2000,
  artist: "New Artist",
  series: "New Series",
  barcodes: { ean: "9501101530003" },
  dimensions: { width: 1, height: 1, unit: "in" },
  shape: "round",
  difficulty: "easy",
  category: toCatalogCategoryId("cc-other"),
  tags: ["z"],
  image: "storage://image-2",
};

describe("baselineFor", () => {
  it("snapshots every field the diff touches", () => {
    const definition = fullDefinition();
    const state = definition.toState();

    const baseline = baselineFor(definition, ALL_FIELD_CHANGES);

    expect(baseline).toEqual({
      title: "Starry Night",
      description: "A swirling night sky over a village.",
      brand: "Ravensburger",
      publisher: "Jumbo",
      pieceCount: 1000,
      artist: "Van Gogh",
      series: "Masterpieces",
      barcodes: {
        ean: "4006381333931",
        upc: "036000291452",
        modelNumber: "RV-1",
      },
      dimensions: { width: 50, height: 70, unit: "cm" },
      shape: "rectangular",
      difficulty: "hard",
      category: toCatalogCategoryId("cc-art"),
      tags: ["a", "b"],
      image: "storage://image-1",
    });
    // tags is copied, not aliased.
    expect(baseline.tags).not.toBe(state.tags);
  });

  it("leaves untouched fields undefined", () => {
    const definition = fullDefinition();

    expect(baselineFor(definition, { title: "X" })).toEqual({
      title: "Starry Night",
    });
  });

  it("copies the tags array rather than aliasing the definition's", () => {
    const definition = fullDefinition();
    const state = definition.toState();

    const baseline = baselineFor(definition, { tags: ["ignored"] });

    expect(baseline.tags).toEqual(["a", "b"]);
    expect(baseline.tags).not.toBe(state.tags);
  });
});

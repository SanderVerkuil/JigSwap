import { describe, expect, it } from "vitest";
import {
  buildProposalArgs,
  formFromView,
  overlayProposal,
  type ProposalFormState,
  type ProposalTargetView,
} from "./proposal-diff";

const view = (
  overrides: Partial<ProposalTargetView> = {},
): ProposalTargetView => ({
  title: "Starry Night",
  pieceCount: 1000,
  brand: "Ravensburger",
  ean: "4006381333931",
  tags: ["art", "van gogh"],
  ...overrides,
});

const categories = [
  { _id: "cat-doc-1", aggregateId: "cat-agg-1" },
  { _id: "cat-doc-legacy", aggregateId: undefined },
];

describe("formFromView", () => {
  it("maps every proposable field, stringifying dimensions and defaulting absents", () => {
    const form = formFromView(
      view({
        description: "A classic",
        artist: "Vincent",
        dimensions: { width: 70, height: 50, unit: "cm" },
        shape: "panoramic",
        difficulty: "hard",
        category: "cat-doc-1",
      }),
    );
    expect(form).toMatchObject({
      title: "Starry Night",
      description: "A classic",
      brand: "Ravensburger",
      pieceCount: 1000,
      artist: "Vincent",
      series: "",
      ean: "4006381333931",
      upc: "",
      modelNumber: "",
      dimensions: { width: "70", height: "50", unit: "cm" },
      shape: "panoramic",
      difficulty: "hard",
      categoryId: "cat-doc-1",
      tags: ["art", "van gogh"],
      newImageStorageId: undefined,
      comment: "",
    });
  });

  it("defaults dimensions to empty strings with cm when absent", () => {
    expect(formFromView(view()).dimensions).toEqual({
      width: "",
      height: "",
      unit: "cm",
    });
  });
});

describe("buildProposalArgs", () => {
  const unchanged = (): ProposalFormState => formFromView(view());

  it("returns null when nothing changed", () => {
    expect(buildProposalArgs(view(), unchanged(), categories)).toBeNull();
  });

  it("includes only the fields that differ, trimming text", () => {
    const form = { ...unchanged(), title: "  Corrected  ", pieceCount: 500 };
    expect(buildProposalArgs(view(), form, categories)).toEqual({
      title: "Corrected",
      pieceCount: 500,
    });
  });

  it("treats an emptied text field as UNCHANGED (backend cannot clear scalars)", () => {
    const form = { ...unchanged(), brand: "  " };
    expect(buildProposalArgs(view(), form, categories)).toBeNull();
  });

  it("treats a trim-equal text value as unchanged", () => {
    const form = { ...unchanged(), title: " Starry Night " };
    expect(buildProposalArgs(view(), form, categories)).toBeNull();
  });

  it("sends the WHOLE barcode group when any member changes — including kept and cleared members", () => {
    const form = { ...unchanged(), upc: "036000291452", modelNumber: "" };
    expect(buildProposalArgs(view(), form, categories)).toEqual({
      ean: "4006381333931", // kept member still sent (group replace)
      upc: "036000291452",
      modelNumber: undefined,
    });
  });

  it("clearing ONE barcode while keeping another sends the group with the cleared member undefined", () => {
    const form = { ...unchanged(), ean: "", upc: "036000291452" };
    expect(buildProposalArgs(view(), form, categories)).toEqual({
      ean: undefined,
      upc: "036000291452",
      modelNumber: undefined,
    });
  });

  it("omits the group when no member changed", () => {
    const form = { ...unchanged(), ean: " 4006381333931 " };
    expect(buildProposalArgs(view(), form, categories)).toBeNull();
  });

  it("clearing ALL barcodes as the sole change yields null (backend cannot clear the whole group)", () => {
    const form = { ...unchanged(), ean: "" }; // view has only ean set
    expect(buildProposalArgs(view(), form, categories)).toBeNull();
  });

  it("includes dimensions only when parsed values differ", () => {
    const base = view({ dimensions: { width: 70, height: 50, unit: "cm" } });
    const same = { ...formFromView(base) };
    expect(buildProposalArgs(base, same, categories)).toBeNull();

    const changed = {
      ...formFromView(base),
      dimensions: { width: "70", height: "50", unit: "in" as const },
    };
    expect(buildProposalArgs(base, changed, categories)).toEqual({
      dimensions: { width: 70, height: 50, unit: "in" },
    });
  });

  it("includes dimensions when the definition previously had none", () => {
    const form = {
      ...unchanged(),
      dimensions: { width: "70", height: "50", unit: "cm" as const },
    };
    expect(buildProposalArgs(view(), form, categories)).toEqual({
      dimensions: { width: 70, height: 50, unit: "cm" },
    });
  });

  it("maps the selected category doc id to its aggregate id, falling back to the doc id for legacy rows", () => {
    const withCat = { ...unchanged(), categoryId: "cat-doc-1" };
    expect(buildProposalArgs(view(), withCat, categories)).toEqual({
      category: "cat-agg-1",
    });

    const legacy = { ...unchanged(), categoryId: "cat-doc-legacy" };
    expect(buildProposalArgs(view(), legacy, categories)).toEqual({
      category: "cat-doc-legacy",
    });
  });

  it("detects tag changes order-sensitively and supports clearing to []", () => {
    const reordered = { ...unchanged(), tags: ["van gogh", "art"] };
    expect(buildProposalArgs(view(), reordered, categories)).toEqual({
      tags: ["van gogh", "art"],
    });

    const cleared = { ...unchanged(), tags: [] };
    expect(buildProposalArgs(view(), cleared, categories)).toEqual({
      tags: [],
    });
  });

  it("includes image only when a NEW storage id was produced", () => {
    const form = { ...unchanged(), newImageStorageId: "storage-123" };
    expect(buildProposalArgs(view(), form, categories)).toEqual({
      image: "storage-123",
    });
  });
});

describe("overlayProposal", () => {
  it("overlays stored changes onto the base form for edit-mode prefill", () => {
    const base = formFromView(view());
    const overlaid = overlayProposal(
      base,
      {
        title: "Corrected",
        barcodes: { upc: "036000291452" },
        dimensions: { width: 70, height: 50, unit: "in" },
        category: "cat-agg-1",
        image: "storage-xyz",
      },
      "box says so",
      categories,
    );
    expect(overlaid).toMatchObject({
      title: "Corrected",
      brand: "Ravensburger", // untouched fields keep the definition's value
      // a stored barcode GROUP replaces all three members (unset ⇒ cleared)
      ean: "",
      upc: "036000291452",
      modelNumber: "",
      dimensions: { width: "70", height: "50", unit: "in" },
      categoryId: "cat-doc-1", // aggregate id resolved back to the select's doc id
      newImageStorageId: "storage-xyz",
      comment: "box says so",
    });
  });

  it("keeps the base's barcodes when the stored changes have no barcode group", () => {
    const base = formFromView(view());
    const overlaid = overlayProposal(
      base,
      { title: "X" },
      undefined,
      categories,
    );
    expect(overlaid).toMatchObject({
      ean: "4006381333931",
      upc: "",
      modelNumber: "",
    });
  });
});

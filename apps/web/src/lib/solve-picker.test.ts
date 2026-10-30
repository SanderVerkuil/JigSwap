import { describe, expect, it } from "vitest";
import {
  buildSolvePickerSections,
  filterSolvePickerSections,
  type SolvePickerSection,
} from "./solve-picker";

// The solve picker lists the member's copies, with the solves they have in progress first so
// picking one finishes it instead of starting another.

const copy = (
  aggregateId: string | undefined,
  title: string,
  over: { brand?: string; pieceCount?: number; coverUrl?: string } = {},
) => ({
  aggregateId,
  coverUrl: over.coverUrl,
  puzzle: {
    title,
    brand: over.brand,
    pieceCount: over.pieceCount ?? 1000,
    images: undefined,
  },
  snapshot: undefined,
});

const empty = { inProgress: [], owned: [] };

const ids = (sections: readonly SolvePickerSection[]) =>
  sections.map((s) => [s.id, s.items.map((i) => i.title)]);

describe("buildSolvePickerSections", () => {
  it("orders in-progress solves before the member's own copies", () => {
    const sections = buildSolvePickerSections({
      inProgress: [
        {
          completionId: "c-1",
          title: "Started one",
          pieceCount: 500,
          startDate: Date.UTC(2026, 9, 3),
          copyId: "elsewhere",
        },
      ],
      owned: [copy("own-1", "Mine")],
    });
    expect(ids(sections)).toEqual([
      ["inProgress", ["Started one"]],
      ["own", ["Mine"]],
    ]);
  });

  it("finishes an in-progress solve and logs an own copy as its owner", () => {
    const sections = buildSolvePickerSections({
      inProgress: [
        {
          completionId: "c-1",
          title: "Started one",
          startDate: Date.UTC(2026, 9, 3),
        },
      ],
      owned: [copy("own-1", "Mine")],
    });
    const targets = sections.flatMap((s) => s.items.map((i) => i.target));
    expect(targets).toEqual([
      {
        kind: "finish",
        completionId: "c-1",
        startDate: Date.UTC(2026, 9, 3),
      },
      { kind: "log", copyId: "own-1", viewerIsOwner: true },
    ]);
  });

  it("lists a copy with a solve in progress only once, as the solve to finish", () => {
    const sections = buildSolvePickerSections({
      inProgress: [
        {
          completionId: "c-own",
          title: "Snapshot title",
          startDate: 1,
          copyId: "own-1",
        },
      ],
      owned: [copy("own-1", "Mine"), copy("own-2", "Also mine")],
    });
    expect(ids(sections)).toEqual([
      ["inProgress", ["Snapshot title"]],
      ["own", ["Also mine"]],
    ]);
  });

  it("shows an in-progress solve with its copy's own cover and brand when the copy is listed", () => {
    const [inProgress] = buildSolvePickerSections({
      inProgress: [
        {
          completionId: "c-1",
          title: "Started one",
          startDate: 1,
          copyId: "own-1",
          thumbnailUrl: "https://img/box-art.jpg",
        },
        {
          completionId: "c-2",
          title: "Copy since deleted",
          startDate: 2,
          copyId: "gone",
          thumbnailUrl: "https://img/other-box-art.jpg",
        },
      ],
      owned: [
        copy("own-1", "Mine", {
          brand: "Jumbo",
          coverUrl: "https://img/my-photo.jpg",
        }),
      ],
    });
    expect(inProgress.items.map((i) => [i.brand, i.imageUrl])).toEqual([
      ["Jumbo", "https://img/my-photo.jpg"],
      [undefined, "https://img/other-box-art.jpg"],
    ]);
  });

  it("skips copies a solve cannot be logged against (no copy id yet)", () => {
    const sections = buildSolvePickerSections({
      ...empty,
      owned: [copy(undefined, "Legacy"), copy("own-1", "Mine")],
    });
    expect(sections[1].items.map((i) => i.title)).toEqual(["Mine"]);
  });

  it("falls back to the copy's snapshot when its catalogue puzzle is gone", () => {
    const sections = buildSolvePickerSections({
      ...empty,
      owned: [
        {
          aggregateId: "own-1",
          puzzle: null,
          snapshot: {
            title: "Kept title",
            brand: "Ravensburger",
            pieceCount: 500,
          },
        },
      ],
    });
    expect(sections[1].items[0]).toMatchObject({
      title: "Kept title",
      brand: "Ravensburger",
      pieceCount: 500,
    });
  });
});

describe("filterSolvePickerSections", () => {
  const sections = buildSolvePickerSections({
    inProgress: [{ completionId: "c-1", title: "Lam Gelegd", startDate: 1 }],
    owned: [
      copy("own-1", "De Kattenshow", { brand: "Jumbo" }),
      copy("own-2", "Tirol", { brand: "Ravensburger" }),
    ],
  });

  it("keeps every item for an empty or blank search", () => {
    expect(filterSolvePickerSections(sections, "")).toEqual(sections);
    expect(filterSolvePickerSections(sections, "   ")).toEqual(sections);
  });

  it("matches title or brand in every section, ignoring case", () => {
    expect(ids(filterSolvePickerSections(sections, "KATTEN"))).toEqual([
      ["inProgress", []],
      ["own", ["De Kattenshow"]],
    ]);
    expect(ids(filterSolvePickerSections(sections, "ravens"))).toEqual([
      ["inProgress", []],
      ["own", ["Tirol"]],
    ]);
    expect(ids(filterSolvePickerSections(sections, " lam "))).toEqual([
      ["inProgress", ["Lam Gelegd"]],
      ["own", []],
    ]);
  });
});

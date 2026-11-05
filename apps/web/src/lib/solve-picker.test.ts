import { describe, expect, it } from "vitest";
import {
  buildSolvePickerSections,
  filterSolvePickerSections,
  type SolvePickerSection,
} from "./solve-picker";

// The solve picker lists everything the member may log a solve for (the server's gate in
// solving/solvableCopy.ts: their own copies, copies they hold on loan, household copies), with
// the solves they have in progress first so picking one finishes it instead of starting another.

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

const householdCopy = (
  aggregateId: string,
  title: string,
  ownerName: string,
) => ({
  ...copy(aggregateId, title),
  household: { owner: { memberId: `m-${ownerName}`, name: ownerName } },
});

const nameOf = (owner: { name?: string }) => owner.name ?? "Puzzler";

const empty = {
  inProgress: [],
  owned: [],
  borrowed: [],
  household: [],
  nameOf,
};

const ids = (sections: readonly SolvePickerSection[]) =>
  sections.map((s) => [s.id, s.items.map((i) => i.title)]);

describe("buildSolvePickerSections", () => {
  it("orders in-progress solves first, then own, borrowed and household copies", () => {
    const sections = buildSolvePickerSections({
      ...empty,
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
      borrowed: [
        { copyId: "loan-1", puzzleTitle: "Lent to me", pieceCount: 750 },
      ],
      household: [householdCopy("hh-1", "Partner's", "Anna")],
    });
    expect(ids(sections)).toEqual([
      ["inProgress", ["Started one"]],
      ["own", ["Mine"]],
      ["borrowed", ["Lent to me"]],
      ["household", ["Partner's"]],
    ]);
  });

  it("finishes an in-progress solve and logs everything else", () => {
    const sections = buildSolvePickerSections({
      ...empty,
      inProgress: [
        {
          completionId: "c-1",
          title: "Started one",
          startDate: Date.UTC(2026, 9, 3),
        },
      ],
      owned: [copy("own-1", "Mine")],
      borrowed: [{ copyId: "loan-1", puzzleTitle: "Lent", pieceCount: 750 }],
      household: [householdCopy("hh-1", "Partner's", "Anna")],
    });
    const targets = sections.flatMap((s) => s.items.map((i) => i.target));
    expect(targets).toEqual([
      {
        kind: "finish",
        completionId: "c-1",
        startDate: Date.UTC(2026, 9, 3),
      },
      { kind: "log", copyId: "own-1", viewerIsOwner: true },
      { kind: "log", copyId: "loan-1", viewerIsOwner: false },
      { kind: "log", copyId: "hh-1", viewerIsOwner: false },
    ]);
  });

  it("lists a copy with a solve in progress only once, as the solve to finish", () => {
    const sections = buildSolvePickerSections({
      ...empty,
      inProgress: [
        {
          completionId: "c-own",
          title: "Snapshot title",
          startDate: 1,
          copyId: "own-1",
        },
        {
          completionId: "c-loan",
          title: "Lent",
          startDate: 2,
          copyId: "loan-1",
        },
        {
          completionId: "c-hh",
          title: "Shared",
          startDate: 3,
          copyId: "hh-1",
        },
      ],
      owned: [copy("own-1", "Mine"), copy("own-2", "Also mine")],
      borrowed: [{ copyId: "loan-1", puzzleTitle: "Lent", pieceCount: 750 }],
      household: [householdCopy("hh-1", "Shared", "Anna")],
    });
    expect(ids(sections)).toEqual([
      ["inProgress", ["Snapshot title", "Lent", "Shared"]],
      ["own", ["Also mine"]],
      ["borrowed", []],
      ["household", []],
    ]);
  });

  it("shows an in-progress solve with its copy's own cover and brand when the copy is listed", () => {
    const [inProgress] = buildSolvePickerSections({
      ...empty,
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

  it("does not list a household copy the member also holds on loan twice", () => {
    const sections = buildSolvePickerSections({
      ...empty,
      borrowed: [{ copyId: "hh-1", puzzleTitle: "Shared", pieceCount: 750 }],
      household: [householdCopy("hh-1", "Shared", "Anna")],
    });
    expect(ids(sections)).toEqual([
      ["inProgress", []],
      ["own", []],
      ["borrowed", ["Shared"]],
      ["household", []],
    ]);
  });

  it("names whose household copy it is", () => {
    const sections = buildSolvePickerSections({
      ...empty,
      household: [householdCopy("hh-1", "Shared", "Anna")],
    });
    expect(sections[3].items[0].ownerName).toBe("Anna");
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
    ...empty,
    inProgress: [{ completionId: "c-1", title: "Lam Gelegd", startDate: 1 }],
    owned: [
      copy("own-1", "De Kattenshow", { brand: "Jumbo" }),
      copy("own-2", "Tirol", { brand: "Ravensburger" }),
    ],
    borrowed: [
      { copyId: "loan-1", puzzleTitle: "Kattenkwaad", pieceCount: 500 },
    ],
    household: [householdCopy("hh-1", "Alpen", "Anna")],
  });

  it("keeps every item for an empty or blank search", () => {
    expect(filterSolvePickerSections(sections, "")).toEqual(sections);
    expect(filterSolvePickerSections(sections, "   ")).toEqual(sections);
  });

  it("matches title, brand or owner in every section, ignoring case", () => {
    expect(ids(filterSolvePickerSections(sections, "KATTEN"))).toEqual([
      ["inProgress", []],
      ["own", ["De Kattenshow"]],
      ["borrowed", ["Kattenkwaad"]],
      ["household", []],
    ]);
    expect(ids(filterSolvePickerSections(sections, "ravens"))).toEqual([
      ["inProgress", []],
      ["own", ["Tirol"]],
      ["borrowed", []],
      ["household", []],
    ]);
    expect(ids(filterSolvePickerSections(sections, "anna"))).toEqual([
      ["inProgress", []],
      ["own", []],
      ["borrowed", []],
      ["household", ["Alpen"]],
    ]);
    expect(ids(filterSolvePickerSections(sections, " lam "))).toEqual([
      ["inProgress", ["Lam Gelegd"]],
      ["own", []],
      ["borrowed", []],
      ["household", []],
    ]);
  });
});

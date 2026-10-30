import type { OwnedCopyView } from "@jigswap/contracts";
import { describe, expect, it } from "vitest";
import {
  filterAndSortCopies,
  filtersFromSearch,
  validateMyPuzzlesSearch,
  type MyPuzzlesFilters,
} from "./my-puzzles-filters";

const copy = (
  id: string,
  title: string,
  over: {
    brand?: string;
    tags?: string[];
    pieceCount?: number;
    createdAt?: number;
    forTrade?: boolean;
    forLend?: boolean;
    forSale?: boolean;
  } = {},
): OwnedCopyView => ({
  _id: id,
  puzzleId: `p_${id}`,
  ownerId: "me",
  condition: "good",
  availability: {
    forTrade: over.forTrade ?? false,
    forLend: over.forLend ?? false,
    forSale: over.forSale ?? false,
  },
  createdAt: over.createdAt ?? 1,
  updatedAt: 1,
  puzzle: {
    _id: `p_${id}`,
    title,
    brand: over.brand,
    tags: over.tags,
    pieceCount: over.pieceCount ?? 500,
    createdAt: 1,
    updatedAt: 1,
  },
});

const ALL: MyPuzzlesFilters = {
  status: "all",
  owner: "all",
  q: "",
  sort: "recent",
};

const run = (
  copies: OwnedCopyView[],
  filters: Partial<MyPuzzlesFilters>,
  context: {
    household?: string[];
    inProgress?: string[];
    completed?: string[];
    lentOut?: string[];
  } = {},
) =>
  filterAndSortCopies(
    copies,
    { ...ALL, ...filters },
    {
      viaHousehold: (id) => context.household?.includes(id) ?? false,
      solveState: (id) => ({
        inProgress: context.inProgress?.includes(id) ?? false,
        completed: context.completed?.includes(id) ?? false,
      }),
      lentOut: (id) => context.lentOut?.includes(id) ?? false,
      locale: "en",
    },
  ).map((c) => c._id);

describe("validateMyPuzzlesSearch", () => {
  it("omits every default, so a bare /my-puzzles stays bare", () => {
    expect(validateMyPuzzlesSearch({})).toEqual({});
    expect(
      validateMyPuzzlesSearch({
        view: "grid",
        status: "all",
        owner: "all",
        sort: "recent",
        q: "  ",
      }),
    ).toEqual({});
  });

  it("keeps known values", () => {
    expect(
      validateMyPuzzlesSearch({
        view: "list",
        status: "forTrade",
        owner: "household",
        sort: "pieces",
        q: " castle ",
      }),
    ).toEqual({
      view: "list",
      status: "forTrade",
      owner: "household",
      sort: "pieces",
      q: "castle",
    });
  });

  it("keeps the Lent Out status", () => {
    expect(validateMyPuzzlesSearch({ status: "lentOut" })).toEqual({
      status: "lentOut",
    });
  });

  it("drops unknown or malformed values", () => {
    expect(
      validateMyPuzzlesSearch({
        view: "table",
        status: "forSale",
        owner: "theirs",
        sort: "price",
        q: { term: "x" },
      }),
    ).toEqual({});
  });

  it("keeps a numeric search the router parsed as a number", () => {
    // TanStack Router JSON-parses search values, so a hand-typed ?q=1000 arrives as a number.
    expect(validateMyPuzzlesSearch({ q: 1000 })).toEqual({ q: "1000" });
  });

  it("caps a very long search", () => {
    expect(validateMyPuzzlesSearch({ q: "x".repeat(300) }).q).toHaveLength(100);
  });
});

describe("filtersFromSearch", () => {
  it("fills in the defaults", () => {
    expect(filtersFromSearch({})).toEqual(ALL);
    expect(filtersFromSearch({ status: "completed", q: "cat" })).toEqual({
      ...ALL,
      status: "completed",
      q: "cat",
    });
  });
});

describe("filterAndSortCopies search", () => {
  const copies = [
    copy("a", "De Kattenshow", { brand: "Jumbo", tags: ["cartoon"] }),
    copy("b", "Oostenrijk, Tirol", { brand: "Ravensburger" }),
    copy("c", "Crème Brûlée", { brand: "Heye", tags: ["food"] }),
  ];

  it("matches the title, brand or a tag, ignoring case", () => {
    expect(run(copies, { q: "katten" })).toEqual(["a"]);
    expect(run(copies, { q: "RAVENSBURGER" })).toEqual(["b"]);
    expect(run(copies, { q: "cartoon" })).toEqual(["a"]);
  });

  it("matches a tag typed with its #", () => {
    expect(run(copies, { q: "#food" })).toEqual(["c"]);
  });

  it("ignores accents either way", () => {
    expect(run(copies, { q: "creme brulee" })).toEqual(["c"]);
    expect(run(copies, { q: "tïrol" })).toEqual(["b"]);
  });

  it("needs every word to match, in any field", () => {
    expect(run(copies, { q: "jumbo katten" })).toEqual(["a"]);
    expect(run(copies, { q: "jumbo tirol" })).toEqual([]);
  });

  it("falls back to the copy's snapshot when the puzzle isn't joined", () => {
    const snapshotOnly: OwnedCopyView = {
      ...copy("s", "ignored"),
      puzzle: null,
      snapshot: { title: "Lam Gelegd", brand: "Jumbo", pieceCount: 500 },
    };
    expect(run([snapshotOnly], { q: "gelegd" })).toEqual(["s"]);
  });
});

describe("filterAndSortCopies filters", () => {
  const copies = [
    copy("trade", "A", { forTrade: true }),
    copy("lend", "B", { forLend: true }),
    copy("sale", "C", { forSale: true }),
    copy("none", "D"),
  ];

  it("narrows by offer", () => {
    expect(run(copies, { status: "available" })).toEqual([
      "trade",
      "lend",
      "sale",
    ]);
    expect(run(copies, { status: "forTrade" })).toEqual(["trade"]);
    expect(run(copies, { status: "forLend" })).toEqual(["lend"]);
  });

  it("keeps lent out apart from offered for lending", () => {
    const context = { lentOut: ["none"] };
    expect(run(copies, { status: "lentOut" }, context)).toEqual(["none"]);
    expect(run(copies, { status: "forLend" }, context)).toEqual(["lend"]);
  });

  it("narrows by solve state", () => {
    const context = { inProgress: ["lend"], completed: ["none"] };
    expect(run(copies, { status: "inProgress" }, context)).toEqual(["lend"]);
    expect(run(copies, { status: "completed" }, context)).toEqual(["none"]);
  });

  it("narrows by whose copy it is", () => {
    const context = { household: ["sale", "none"] };
    expect(run(copies, { owner: "mine" }, context)).toEqual(["trade", "lend"]);
    expect(run(copies, { owner: "household" }, context)).toEqual([
      "sale",
      "none",
    ]);
  });

  it("combines search, status and owner", () => {
    const context = { household: ["lend"] };
    expect(
      run(copies, { q: "b", status: "available", owner: "household" }, context),
    ).toEqual(["lend"]);
  });
});

describe("filterAndSortCopies sort", () => {
  const copies = [
    copy("old", "banana", { createdAt: 1, pieceCount: 1000 }),
    copy("new", "Apple", { createdAt: 3, pieceCount: 500 }),
    copy("mid", "cherry", { createdAt: 2, pieceCount: 500 }),
  ];

  it("puts the most recently added first by default", () => {
    expect(run(copies, {})).toEqual(["new", "mid", "old"]);
  });

  it("sorts by title, ignoring case", () => {
    expect(run(copies, { sort: "title" })).toEqual(["new", "old", "mid"]);
  });

  it("sorts by fewest pieces first, then by title", () => {
    expect(run(copies, { sort: "pieces" })).toEqual(["new", "mid", "old"]);
  });

  it("doesn't reorder the input", () => {
    const input = [...copies];
    run(input, { sort: "title" });
    expect(input.map((c) => c._id)).toEqual(["old", "new", "mid"]);
  });
});

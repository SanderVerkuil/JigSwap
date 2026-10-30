import { describe, expect, it } from "vitest";
import {
  browseEmptyState,
  browseFiltersFromSearch,
  browseSearchFromFilters,
  validateBrowseSearch,
  withoutBrowseConditions,
} from "./browse-search";

describe("validateBrowseSearch", () => {
  it("keeps a puzzle id string", () => {
    expect(validateBrowseSearch({ puzzle: "abc123" })).toEqual({
      puzzle: "abc123",
    });
  });

  it("drops a missing puzzle param", () => {
    expect(validateBrowseSearch({})).toEqual({ puzzle: undefined });
  });

  it("drops an empty or whitespace-only puzzle param", () => {
    expect(validateBrowseSearch({ puzzle: "" })).toEqual({ puzzle: undefined });
    expect(validateBrowseSearch({ puzzle: "  " })).toEqual({
      puzzle: undefined,
    });
  });

  it("drops non-string values (numbers, arrays, objects)", () => {
    expect(validateBrowseSearch({ puzzle: 42 })).toEqual({ puzzle: undefined });
    expect(validateBrowseSearch({ puzzle: ["a"] })).toEqual({
      puzzle: undefined,
    });
    expect(validateBrowseSearch({ puzzle: { id: "a" } })).toEqual({
      puzzle: undefined,
    });
  });

  it("ignores unrelated params", () => {
    expect(validateBrowseSearch({ puzzle: "abc", other: "x" })).toEqual({
      puzzle: "abc",
    });
  });

  it("keeps every filter, the term and the list view", () => {
    expect(
      validateBrowseSearch({
        puzzle: "p1",
        q: "  harbour ",
        category: "cat-1",
        condition: "like_new",
        difficulty: "hard",
        minPieces: 500,
        maxPieces: "1000",
        avail: ["forLend", "forSale"],
        view: "list",
      }),
    ).toEqual({
      puzzle: "p1",
      q: "harbour",
      category: "cat-1",
      condition: "like_new",
      difficulty: "hard",
      minPieces: 500,
      maxPieces: 1000,
      avail: ["forLend", "forSale"],
      view: "list",
    });
  });

  it("leaves defaults out, so a bare /browse stays bare", () => {
    expect(
      validateBrowseSearch({ q: " ", avail: [], view: "grid", category: "" }),
    ).toStrictEqual({});
  });

  it("drops values Browse can't filter by", () => {
    expect(
      validateBrowseSearch({
        condition: "mint",
        difficulty: "impossible",
        minPieces: "lots",
        maxPieces: -5,
        avail: ["forFree"],
        view: "table",
      }),
    ).toStrictEqual({});
  });

  it("reads one channel, ignores unknown ones and repeats", () => {
    expect(validateBrowseSearch({ avail: "forTrade" }).avail).toEqual([
      "forTrade",
    ]);
    expect(
      validateBrowseSearch({ avail: ["forLend", "forFree", "forLend"] }).avail,
    ).toEqual(["forLend"]);
  });
});

describe("browse filters and the URL", () => {
  it("turns the URL into the builder's form values", () => {
    expect(
      browseFiltersFromSearch({
        category: "cat-1",
        condition: "good",
        minPieces: 500,
        avail: ["forTrade"],
      }),
    ).toEqual({
      category: "cat-1",
      condition: "good",
      difficulty: "",
      minPieces: "500",
      maxPieces: "",
      availability: ["forTrade"],
    });
  });

  it("writes the form values back, clearing what is empty", () => {
    expect(
      browseSearchFromFilters({
        category: "",
        condition: "fair",
        difficulty: "easy",
        minPieces: "",
        maxPieces: "750",
        availability: [],
      }),
    ).toEqual({
      category: undefined,
      condition: "fair",
      difficulty: "easy",
      minPieces: undefined,
      maxPieces: 750,
      avail: undefined,
    });
  });

  it("round-trips a validated URL", () => {
    const search = validateBrowseSearch({
      category: "cat-2",
      difficulty: "expert",
      maxPieces: 2000,
      avail: ["forSale"],
    });
    expect(
      validateBrowseSearch(
        browseSearchFromFilters(browseFiltersFromSearch(search)),
      ),
    ).toEqual(search);
  });
});

describe("browseEmptyState", () => {
  it("blames the text or filters only when one is set", () => {
    expect(browseEmptyState({ q: "café" })).toBe("filtered");
    expect(browseEmptyState({ avail: ["forLend"] })).toBe("filtered");
    expect(browseEmptyState({ minPieces: 0 })).toBe("filtered");
    expect(browseEmptyState({ puzzle: "p1", condition: "good" })).toBe(
      "filtered",
    );
  });

  it("says nobody offers the puzzle when only ?puzzle narrows Browse", () => {
    expect(browseEmptyState({ puzzle: "p1" })).toBe("puzzleNotOffered");
    expect(browseEmptyState({ puzzle: "p1", view: "list" })).toBe(
      "puzzleNotOffered",
    );
  });

  it("says nobody offers anything when nothing narrows Browse", () => {
    expect(browseEmptyState({})).toBe("noOffers");
    expect(browseEmptyState({ view: "list" })).toBe("noOffers");
    // A cleared condition left behind as undefined by a merge is not a condition.
    expect(browseEmptyState({ q: undefined, avail: undefined })).toBe(
      "noOffers",
    );
  });
});

describe("withoutBrowseConditions", () => {
  it("clears the text and every filter but keeps ?puzzle and the view", () => {
    const search = validateBrowseSearch({
      puzzle: "p1",
      q: "café",
      category: "cat-1",
      condition: "good",
      difficulty: "hard",
      minPieces: 500,
      maxPieces: 1000,
      avail: ["forTrade"],
      view: "list",
    });
    expect(withoutBrowseConditions(search)).toEqual({
      puzzle: "p1",
      view: "list",
    });
    expect(browseEmptyState(withoutBrowseConditions(search))).toBe(
      "puzzleNotOffered",
    );
  });
});

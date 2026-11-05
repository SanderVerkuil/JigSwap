import { defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { EMPTY_CATALOGUE_FILTERS } from "./catalogue-filters";
import {
  facetSearch,
  filtersFromSearch,
  validatePuzzlesSearch,
} from "./puzzles-search";

describe("validatePuzzlesSearch", () => {
  it("keeps every valid parameter", () => {
    expect(
      validatePuzzlesSearch({
        q: "haasteren",
        brand: "Jumbo",
        minPieces: 500,
        maxPieces: 1000,
        difficulty: "hard",
        category: "cat_1",
        tags: ["water", "nature"],
        fav: true,
        view: "list",
      }),
    ).toEqual({
      q: "haasteren",
      brand: "Jumbo",
      minPieces: 500,
      maxPieces: 1000,
      difficulty: "hard",
      category: "cat_1",
      tags: ["water", "nature"],
      fav: true,
      view: "list",
    });
  });

  it("gives no value for no parameters, so a bare /puzzles stays bare", () => {
    expect(defaultStringifySearch(validatePuzzlesSearch({}))).toBe("");
  });

  it("returns every known key, so a dropped value replaces the raw one", () => {
    expect(Object.keys(validatePuzzlesSearch({})).sort()).toEqual(
      [
        "brand",
        "category",
        "difficulty",
        "fav",
        "maxPieces",
        "minPieces",
        "q",
        "tags",
        "view",
      ].sort(),
    );
  });

  it("drops blank, malformed and unknown values", () => {
    expect(
      validatePuzzlesSearch({
        q: "   ",
        brand: [42],
        minPieces: "lots",
        maxPieces: -1,
        difficulty: "impossible",
        category: "",
        tags: [null, ""],
        fav: "yes",
        view: "grid",
        other: "x",
      }),
    ).toEqual({});
  });

  it("accepts numeric strings for the piece range and one tag as a string", () => {
    expect(
      validatePuzzlesSearch({
        minPieces: "500",
        maxPieces: " 750 ",
        tags: "x",
      }),
    ).toEqual({ minPieces: 500, maxPieces: 750, tags: ["x"] });
  });

  it("reads a bare number or boolean as the text it was typed as", () => {
    expect(
      validatePuzzlesSearch({
        q: 2000,
        brand: 123,
        category: 5,
        tags: [1, true, "a"],
      }),
    ).toEqual({
      q: "2000",
      brand: "123",
      category: "5",
      tags: ["1", "true", "a"],
    });
    expect(validatePuzzlesSearch({ q: true }).q).toBe("true");
  });

  it("trims the term and de-duplicates tags", () => {
    expect(
      validatePuzzlesSearch({ q: "  lake ", tags: ["a", "b", "a"] }),
    ).toEqual({ q: "lake", tags: ["a", "b"] });
  });
});

describe("filtersFromSearch / facetSearch", () => {
  it("turns the URL into form values and back", () => {
    const search = {
      q: "lake",
      brand: "Jumbo",
      minPieces: 500,
      difficulty: "easy" as const,
      tags: ["water"],
    };
    const filters = filtersFromSearch(search);
    expect(filters).toEqual({
      ...EMPTY_CATALOGUE_FILTERS,
      searchTerm: "lake",
      brand: "Jumbo",
      minPieces: "500",
      difficulty: "easy",
      tags: ["water"],
    });
    expect(facetSearch(filters)).toEqual({
      brand: "Jumbo",
      minPieces: 500,
      maxPieces: undefined,
      difficulty: "easy",
      category: undefined,
      tags: ["water"],
    });
  });

  it("clears every facet for empty form values", () => {
    expect(facetSearch(EMPTY_CATALOGUE_FILTERS)).toEqual({
      brand: undefined,
      minPieces: undefined,
      maxPieces: undefined,
      difficulty: undefined,
      category: undefined,
      tags: undefined,
    });
  });
});

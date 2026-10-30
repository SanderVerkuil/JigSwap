import { describe, expect, it } from "vitest";
import {
  catalogueSearchArgs,
  EMPTY_CATALOGUE_FILTERS,
  favouritesInCatalogue,
  hasActiveCatalogueFilters,
  matchesCatalogueSearch,
} from "./catalogue-filters";

const puzzle = {
  title: "Mountain Lake",
  brand: "Ravensburger",
  pieceCount: 1000,
  difficulty: "hard" as const,
  category: "cat_1",
  tags: ["water", "nature"],
  status: "approved" as const,
};

describe("catalogueSearchArgs", () => {
  it("sends no facet at all when nothing is set", () => {
    expect(catalogueSearchArgs(EMPTY_CATALOGUE_FILTERS)).toEqual({});
  });

  it("normalises the term and converts the piece bounds to numbers", () => {
    expect(
      catalogueSearchArgs({
        searchTerm: "  Mountain   LAKE ",
        brand: "Ravensburger",
        minPieces: "500",
        maxPieces: "1000",
        difficulty: "hard",
        category: "cat_1",
        tags: ["water"],
      }),
    ).toEqual({
      searchTerm: "mountain lake",
      brand: "Ravensburger",
      pieceMin: 500,
      pieceMax: 1000,
      difficulty: "hard",
      category: "cat_1",
      tags: ["water"],
    });
  });

  it("drops values the server would reject", () => {
    expect(
      catalogueSearchArgs({
        ...EMPTY_CATALOGUE_FILTERS,
        searchTerm: "   ",
        minPieces: "lots",
        maxPieces: " ",
        difficulty: "impossible",
      }),
    ).toEqual({});
  });
});

describe("matchesCatalogueSearch", () => {
  it("matches everything when no facet is set", () => {
    expect(matchesCatalogueSearch(puzzle, {})).toBe(true);
  });

  it("matches every word of the term against the title, brand and tags", () => {
    expect(matchesCatalogueSearch(puzzle, { searchTerm: "lake" })).toBe(true);
    expect(matchesCatalogueSearch(puzzle, { searchTerm: "ravens water" })).toBe(
      true,
    );
    expect(matchesCatalogueSearch(puzzle, { searchTerm: "lake forest" })).toBe(
      false,
    );
  });

  it.each([
    [{ brand: "Ravensburger" }, true],
    [{ brand: "Jumbo" }, false],
    [{ pieceMin: 1000 }, true],
    [{ pieceMin: 1001 }, false],
    [{ pieceMax: 1000 }, true],
    [{ pieceMax: 999 }, false],
    [{ difficulty: "hard" as const }, true],
    [{ difficulty: "easy" as const }, false],
    [{ category: "cat_1" }, true],
    [{ category: "cat_2" }, false],
    [{ tags: ["forest", "water"] }, true],
    [{ tags: ["forest"] }, false],
  ])("applies %j like the server does", (args, expected) => {
    expect(matchesCatalogueSearch(puzzle, args)).toBe(expected);
  });
});

describe("favouritesInCatalogue", () => {
  it("keeps only approved favourites that match the facets", () => {
    const favourites = [
      puzzle,
      { ...puzzle, title: "Forest", tags: ["forest"] },
      { ...puzzle, title: "Pending Lake", status: "pending" as const },
    ];
    expect(
      favouritesInCatalogue(favourites, { tags: ["water"] }).map(
        (p) => p.title,
      ),
    ).toEqual(["Mountain Lake"]);
  });
});

describe("hasActiveCatalogueFilters", () => {
  it("is false for the empty filters and true once any filter is set", () => {
    expect(hasActiveCatalogueFilters(EMPTY_CATALOGUE_FILTERS)).toBe(false);
    expect(
      hasActiveCatalogueFilters({ ...EMPTY_CATALOGUE_FILTERS, tags: ["x"] }),
    ).toBe(true);
    expect(
      hasActiveCatalogueFilters({
        ...EMPTY_CATALOGUE_FILTERS,
        searchTerm: "lake",
      }),
    ).toBe(true);
  });
});

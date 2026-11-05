import { describe, expect, it } from "vitest";
import {
  normalizeCatalogQuery,
  publicCatalogFilterArgs,
  validatePublicCatalogSearch,
} from "./public-catalog-search";

describe("validatePublicCatalogSearch", () => {
  it("keeps a search term, a brand and a known piece bucket", () => {
    expect(
      validatePublicCatalogSearch({
        q: "ravensburger castle",
        brand: "Ravensburger",
        pieces: "b1000",
      }),
    ).toEqual({
      q: "ravensburger castle",
      brand: "Ravensburger",
      pieces: "b1000",
    });
  });

  it("returns no filters for a bare /catalog", () => {
    expect(validatePublicCatalogSearch({})).toEqual({
      q: undefined,
      brand: undefined,
      pieces: undefined,
    });
  });

  it("trims the search term and brand, and drops blank ones", () => {
    expect(validatePublicCatalogSearch({ q: "  cats ", brand: " " })).toEqual({
      q: "cats",
      brand: undefined,
      pieces: undefined,
    });
    expect(validatePublicCatalogSearch({ q: "", brand: "" }).q).toBeUndefined();
  });

  it("drops a piece bucket it doesn't know", () => {
    expect(validatePublicCatalogSearch({ pieces: "b2000" }).pieces).toBe(
      undefined,
    );
    expect(validatePublicCatalogSearch({ pieces: "all" }).pieces).toBe(
      undefined,
    );
  });

  // The router parses `?q=1000` into a number and `?q=true` into a boolean before this runs, and
  // a piece count is a natural search here, so a hand-written link keeps its term.
  it("keeps a search term or brand the router parsed as a number or boolean", () => {
    expect(validatePublicCatalogSearch({ q: 1000, brand: 123 })).toEqual({
      q: "1000",
      brand: "123",
      pieces: undefined,
    });
    expect(validatePublicCatalogSearch({ q: true, brand: false })).toEqual({
      q: "true",
      brand: "false",
      pieces: undefined,
    });
    expect(validatePublicCatalogSearch({ q: 0 }).q).toBe("0");
  });

  it("drops arrays, objects and null", () => {
    expect(
      validatePublicCatalogSearch({ q: ["a"], brand: { a: 1 }, pieces: 500 }),
    ).toEqual({ q: undefined, brand: undefined, pieces: undefined });
    expect(validatePublicCatalogSearch({ q: null }).q).toBeUndefined();
  });

  it("ignores unrelated params", () => {
    expect(validatePublicCatalogSearch({ q: "cats", utm_source: "x" })).toEqual(
      { q: "cats", brand: undefined, pieces: undefined },
    );
  });
});

describe("normalizeCatalogQuery", () => {
  it("trims typed input and treats blank input as no search", () => {
    expect(normalizeCatalogQuery(" cats  ")).toBe("cats");
    expect(normalizeCatalogQuery("   ")).toBeUndefined();
    expect(normalizeCatalogQuery("")).toBeUndefined();
  });
});

describe("publicCatalogFilterArgs", () => {
  it("sends no filter args for an unfiltered catalogue", () => {
    expect(publicCatalogFilterArgs({})).toEqual({});
  });

  it("maps the URL filters onto the publicBrowse args", () => {
    expect(
      publicCatalogFilterArgs({
        q: "castle",
        brand: "Ravensburger",
        pieces: "b1000",
      }),
    ).toEqual({
      searchTerm: "castle",
      brand: "Ravensburger",
      pieceMin: 1000,
      pieceMax: 1499,
    });
  });

  it("maps every piece bucket to its range", () => {
    expect(publicCatalogFilterArgs({ pieces: "lt500" })).toEqual({
      pieceMax: 499,
    });
    expect(publicCatalogFilterArgs({ pieces: "b500" })).toEqual({
      pieceMin: 500,
      pieceMax: 999,
    });
    expect(publicCatalogFilterArgs({ pieces: "b1500" })).toEqual({
      pieceMin: 1500,
    });
  });

  // The loader and the page build their first-page query from these args, so
  // both must produce the same key whatever undefined fields the search holds.
  it("omits absent filters instead of sending undefined", () => {
    expect(
      Object.keys(
        publicCatalogFilterArgs({
          q: undefined,
          brand: undefined,
          pieces: undefined,
        }),
      ),
    ).toEqual([]);
  });
});

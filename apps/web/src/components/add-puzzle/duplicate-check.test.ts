import { describe, expect, it } from "vitest";
import {
  duplicateCandidates,
  duplicateLookups,
  titlesOverlap,
} from "./duplicate-check";

describe("duplicateLookups", () => {
  const lookups = (title: string, ean = "", upc = "") =>
    duplicateLookups({ title, ean, upc });

  it("searches titles from three characters, on the normalised term", () => {
    expect(lookups("").titleTerm).toBeNull();
    expect(lookups("  Ca  ").titleTerm).toBeNull();
    expect(lookups("  Café  ").titleTerm).toBe("café");
    expect(lookups("Starry   NIGHT").titleTerm).toBe("starry night");
  });

  it("looks up a typed EAN, else a typed UPC, only once it is barcode-shaped", () => {
    expect(lookups("", "400638133393").barcode).toBe("400638133393");
    expect(lookups("", "4006381333931").barcode).toBe("4006381333931");
    expect(lookups("", "4006 3813 33931").barcode).toBe("4006381333931");
    expect(lookups("", "40063", "036000291452").barcode).toBe("036000291452");
    expect(lookups("", "40063", "0360").barcode).toBeNull();
    expect(lookups("Café 1000").barcode).toBeNull();
  });
});

describe("titlesOverlap", () => {
  it("matches the same title regardless of case and accents", () => {
    expect(titlesOverlap("café", "Café")).toBe(true);
    expect(titlesOverlap("cafe", "Café")).toBe(true);
  });

  it("matches when one title contains every word of the other", () => {
    expect(titlesOverlap("starry night", "Starry Night (Van Gogh)")).toBe(true);
    expect(titlesOverlap("starry night van gogh", "Starry Night")).toBe(true);
  });

  it("treats the last typed word as a prefix, since it may be half typed", () => {
    expect(titlesOverlap("the nig", "The Night Watch")).toBe(true);
    expect(titlesOverlap("nig the", "The Night Watch")).toBe(false);
  });

  it("does not call titles that merely share a word the same puzzle", () => {
    expect(titlesOverlap("sunset over the lake", "The Lake House")).toBe(false);
    expect(titlesOverlap("de kermis", "De Markt")).toBe(false);
  });
});

describe("duplicateCandidates", () => {
  const row = (_id: string, title: string) => ({ _id, title });
  const cafe = row("p1", "Café");
  const cafeNight = row("p2", "Café at Night");
  const market = row("p3", "De Markt");

  it("keeps only title matches that overlap the typed title", () => {
    expect(
      duplicateCandidates({
        titleTerm: "café",
        titleMatches: [cafe, market, cafeNight],
        barcodeMatch: null,
        dismissed: new Set(),
      }),
    ).toEqual({ byBarcode: null, byTitle: [cafe, cafeNight] });
  });

  it("leaves out dismissed puzzles and shows a barcode match only once", () => {
    expect(
      duplicateCandidates({
        titleTerm: "café",
        titleMatches: [cafe, cafeNight],
        barcodeMatch: cafe,
        dismissed: new Set(["p2"]),
      }),
    ).toEqual({ byBarcode: cafe, byTitle: [] });
    expect(
      duplicateCandidates({
        titleTerm: "café",
        titleMatches: [cafe],
        barcodeMatch: cafe,
        dismissed: new Set(["p1"]),
      }),
    ).toEqual({ byBarcode: null, byTitle: [] });
  });

  it("shows at most three title matches", () => {
    const many = ["a", "b", "c", "d"].map((id) => row(id, "Café"));
    expect(
      duplicateCandidates({
        titleTerm: "café",
        titleMatches: many,
        barcodeMatch: undefined,
        dismissed: new Set(),
      }).byTitle,
    ).toHaveLength(3);
  });

  it("shows nothing while there is no search term or result yet", () => {
    expect(
      duplicateCandidates({
        titleTerm: null,
        titleMatches: [cafe],
        barcodeMatch: undefined,
        dismissed: new Set(),
      }),
    ).toEqual({ byBarcode: null, byTitle: [] });
    expect(
      duplicateCandidates({
        titleTerm: "café",
        titleMatches: undefined,
        barcodeMatch: undefined,
        dismissed: new Set(),
      }),
    ).toEqual({ byBarcode: null, byTitle: [] });
  });
});

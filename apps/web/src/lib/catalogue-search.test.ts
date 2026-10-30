import { describe, expect, it } from "vitest";
import {
  catalogueSearchKey,
  detectBarcode,
  isPartialBarcode,
} from "./catalogue-search";

describe("detectBarcode", () => {
  it("accepts 12 and 13 digit codes", () => {
    expect(detectBarcode("036000291452")).toBe("036000291452");
    expect(detectBarcode("4006381333931")).toBe("4006381333931");
  });

  it("strips the spaces and dashes people type or scanners add", () => {
    expect(detectBarcode(" 4 006381 333931 ")).toBe("4006381333931");
    expect(detectBarcode("4006-3813-33931")).toBe("4006381333931");
  });

  it("rejects other lengths and anything with non-digits", () => {
    expect(detectBarcode("")).toBeNull();
    expect(detectBarcode("1000")).toBeNull();
    // EAN-8 is not stored by the catalogue, so 8 digits fall through to text search.
    expect(detectBarcode("12345670")).toBeNull();
    expect(detectBarcode("12345678901")).toBeNull();
    expect(detectBarcode("40063813339310")).toBeNull();
    expect(detectBarcode("Lake 1000")).toBeNull();
    expect(detectBarcode("4006381333931a")).toBeNull();
  });
});

describe("isPartialBarcode", () => {
  it("is true for the start of a barcode: 6 to 11 digits", () => {
    expect(isPartialBarcode("871012")).toBe(true);
    expect(isPartialBarcode("8710126")).toBe(true);
    expect(isPartialBarcode("87101260001")).toBe(true);
  });

  it("strips spaces and dashes like detectBarcode", () => {
    expect(isPartialBarcode(" 8 710-126 ")).toBe(true);
  });

  it("is false for short numbers people search by (piece counts, years)", () => {
    expect(isPartialBarcode("1000")).toBe(false);
    expect(isPartialBarcode("12000")).toBe(false);
  });

  it("is false for a whole barcode, text, or nothing", () => {
    expect(isPartialBarcode("036000291452")).toBe(false);
    expect(isPartialBarcode("4006381333931")).toBe(false);
    expect(isPartialBarcode("Lake 1000")).toBe(false);
    expect(isPartialBarcode("8710126a")).toBe(false);
    expect(isPartialBarcode("")).toBe(false);
  });
});

describe("catalogueSearchKey", () => {
  it("trims, lowercases and collapses whitespace", () => {
    expect(catalogueSearchKey("  Mountain   LAKE ")).toBe("mountain lake");
  });

  it("gives cosmetic edits the same key, so they don't re-query", () => {
    expect(catalogueSearchKey("lake ")).toBe(catalogueSearchKey("Lake"));
  });

  it("is empty for blank input", () => {
    expect(catalogueSearchKey("   ")).toBe("");
  });
});

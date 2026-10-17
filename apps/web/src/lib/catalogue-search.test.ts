import { describe, expect, it } from "vitest";
import { catalogueSearchKey, detectBarcode } from "./catalogue-search";

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

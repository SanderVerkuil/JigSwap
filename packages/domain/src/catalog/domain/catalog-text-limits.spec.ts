import { describe, expect, it } from "vitest";
import {
  CATALOG_TEXT_LIMITS,
  checkCatalogText,
  MAX_CATALOG_TAGS,
} from "./catalog-text-limits";

describe("catalogue text limits", () => {
  it("are the bounds the catalogue promises (SEC-26)", () => {
    expect(CATALOG_TEXT_LIMITS).toEqual({
      title: 200,
      description: 5_000,
      brand: 100,
      publisher: 100,
      artist: 100,
      series: 100,
      modelNumber: 100,
      category: 64,
      tag: 50,
      comment: 2_000,
    });
    expect(MAX_CATALOG_TAGS).toBe(20);
  });
});

describe("checkCatalogText", () => {
  it("accepts absent fields", () => {
    expect(checkCatalogText({}).isOk).toBe(true);
  });

  const stringFields = [
    "title",
    "description",
    "brand",
    "publisher",
    "artist",
    "series",
    "modelNumber",
    "category",
    "comment",
  ] as const;

  it.each(stringFields)("accepts a %s at its limit", (field) => {
    const max = CATALOG_TEXT_LIMITS[field];
    expect(checkCatalogText({ [field]: "x".repeat(max) }).isOk).toBe(true);
  });

  it.each(stringFields)(
    "refuses a %s one past its limit with TextTooLong",
    (field) => {
      const max = CATALOG_TEXT_LIMITS[field];
      const r = checkCatalogText({ [field]: "x".repeat(max + 1) });
      expect(r.isErr).toBe(true);
      if (r.isErr) {
        expect(r.error.code).toBe("TextTooLong");
        expect(r.error.message).toBe(
          `The ${field} can be at most ${max} characters`,
        );
      }
    },
  );

  it("accepts the most tags, each at the tag limit", () => {
    const tags = Array.from({ length: MAX_CATALOG_TAGS }, (_, i) =>
      `${i}`.padEnd(CATALOG_TEXT_LIMITS.tag, "x"),
    );
    expect(checkCatalogText({ tags }).isOk).toBe(true);
  });

  it("refuses one tag too many with TextTooLong", () => {
    const tags = Array.from(
      { length: MAX_CATALOG_TAGS + 1 },
      (_, i) => `t${i}`,
    );
    const r = checkCatalogText({ tags });
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("TextTooLong");
      expect(r.error.message).toBe("The tags can be at most 20 entries");
    }
  });

  it("refuses a tag one past the tag limit with TextTooLong", () => {
    const r = checkCatalogText({
      tags: ["ok", "x".repeat(CATALOG_TEXT_LIMITS.tag + 1)],
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) {
      expect(r.error.code).toBe("TextTooLong");
      expect(r.error.message).toBe("The tag can be at most 50 characters");
    }
  });
});

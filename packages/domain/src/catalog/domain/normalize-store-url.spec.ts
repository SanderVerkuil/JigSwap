// packages/domain/src/catalog/domain/normalize-store-url.spec.ts
import { describe, expect, it } from "vitest";
import { normalizeStoreUrl } from "./normalize-store-url";

describe("normalizeStoreUrl", () => {
  it("lowercases scheme and host", () => {
    expect(normalizeStoreUrl("HTTPS://Shop.Example.COM/p/1")).toBe(
      "https://shop.example.com/p/1",
    );
  });

  it("drops the fragment", () => {
    expect(normalizeStoreUrl("https://a.com/p#reviews")).toBe(
      "https://a.com/p",
    );
  });

  it("strips tracking params but keeps meaningful query", () => {
    expect(
      normalizeStoreUrl("https://a.com/p?id=9&utm_source=x&gclid=y&fbclid=z"),
    ).toBe("https://a.com/p?id=9");
  });

  it("trims a trailing slash except for the root path", () => {
    expect(normalizeStoreUrl("https://a.com/p/")).toBe("https://a.com/p");
    expect(normalizeStoreUrl("https://a.com/")).toBe("https://a.com/");
  });

  it("throws on a non-URL", () => {
    expect(() => normalizeStoreUrl("not a url")).toThrow();
  });
});

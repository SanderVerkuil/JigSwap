// packages/domain/src/catalog/domain/normalize-store-url.spec.ts
import { describe, expect, it } from "vitest";
import { normalizeStoreUrl } from "./normalize-store-url";

describe("normalizeStoreUrl", () => {
  it("lowercases scheme and host", () => {
    expect(normalizeStoreUrl("HTTPS://Shop.Example.COM/p/1")).toBe(
      "https://shop.example.com/p/1",
    );
  });

  it("lowercases the host but preserves path case", () => {
    expect(normalizeStoreUrl("https://Shop.Example.COM/Product/AbC")).toBe(
      "https://shop.example.com/Product/AbC",
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

  // --- input.trim() (L8): non-breaking-space prefix is stripped by trim()
  // but NOT by the URL parser, so without trim() the URL constructor throws. ---
  it("trims a leading non-breaking space before parsing", () => {
    expect(normalizeStoreUrl(" https://a.com/p")).toBe("https://a.com/p");
  });

  it("trims a trailing non-breaking space before parsing", () => {
    expect(normalizeStoreUrl("https://a.com/p ")).toBe("https://a.com/p");
  });

  // --- Each tracking param is removed only on an exact-anchored match. ---
  it("removes any utm_* prefixed param", () => {
    expect(
      normalizeStoreUrl("https://a.com/p?utm_source=x&utm_medium=y&id=1"),
    ).toBe("https://a.com/p?id=1");
  });

  it("removes gclid exactly", () => {
    expect(normalizeStoreUrl("https://a.com/p?gclid=abc&id=1")).toBe(
      "https://a.com/p?id=1",
    );
  });

  it("removes fbclid exactly", () => {
    expect(normalizeStoreUrl("https://a.com/p?fbclid=abc&id=1")).toBe(
      "https://a.com/p?id=1",
    );
  });

  it("removes mc_eid exactly", () => {
    expect(normalizeStoreUrl("https://a.com/p?mc_eid=abc&id=1")).toBe(
      "https://a.com/p?id=1",
    );
  });

  it("removes _ga exactly", () => {
    expect(normalizeStoreUrl("https://a.com/p?_ga=abc&id=1")).toBe(
      "https://a.com/p?id=1",
    );
  });

  it("removes ref exactly", () => {
    expect(normalizeStoreUrl("https://a.com/p?ref=abc&id=1")).toBe(
      "https://a.com/p?id=1",
    );
  });

  it("is case-insensitive when matching tracking params", () => {
    expect(normalizeStoreUrl("https://a.com/p?UTM_Source=x&GCLID=y&id=1")).toBe(
      "https://a.com/p?id=1",
    );
  });

  // --- The "^" anchor: tracking names must match at the START of the key.
  // A key that merely CONTAINS the tracking token must be preserved. ---
  it("keeps params that only contain a tracking token mid-string (anchored ^)", () => {
    expect(
      normalizeStoreUrl(
        "https://a.com/p?xgclid=1&x_ga=2&product_ref=3&xref=4&id=5",
      ),
    ).toBe("https://a.com/p?xgclid=1&x_ga=2&product_ref=3&xref=4&id=5");
  });

  // --- The trailing "$" anchors: a tracking name with extra trailing chars
  // must be preserved (gclid$, fbclid$, mc_eid$, _ga$, ref$). ---
  it("keeps gclidx (gclid$ trailing anchor)", () => {
    expect(normalizeStoreUrl("https://a.com/p?gclidx=1&id=2")).toBe(
      "https://a.com/p?gclidx=1&id=2",
    );
  });

  it("keeps fbclidx (fbclid$ trailing anchor)", () => {
    expect(normalizeStoreUrl("https://a.com/p?fbclidx=1&id=2")).toBe(
      "https://a.com/p?fbclidx=1&id=2",
    );
  });

  it("keeps mc_eidx (mc_eid$ trailing anchor)", () => {
    expect(normalizeStoreUrl("https://a.com/p?mc_eidx=1&id=2")).toBe(
      "https://a.com/p?mc_eidx=1&id=2",
    );
  });

  it("keeps _gax (_ga$ trailing anchor)", () => {
    expect(normalizeStoreUrl("https://a.com/p?_gax=1&id=2")).toBe(
      "https://a.com/p?_gax=1&id=2",
    );
  });

  it("keeps reference and refx (ref$ trailing anchor)", () => {
    expect(normalizeStoreUrl("https://a.com/p?reference=1&refx=2&id=3")).toBe(
      "https://a.com/p?reference=1&refx=2&id=3",
    );
  });

  // --- Trailing-slash strip regex /\/+$/ collapses ALL trailing slashes,
  // not just one (kills /\/$/ mutant). ---
  it("collapses multiple trailing slashes", () => {
    expect(normalizeStoreUrl("https://a.com/p///")).toBe("https://a.com/p");
  });

  it("strips a single trailing slash on a deep path", () => {
    expect(normalizeStoreUrl("https://a.com/x/y/")).toBe("https://a.com/x/y");
  });
});

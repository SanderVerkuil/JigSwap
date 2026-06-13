// packages/domain/src/catalog/domain/extract-puzzle-draft.spec.ts
import { describe, expect, it } from "vitest";
import { extractPuzzleDraft } from "./extract-puzzle-draft";
import type { RawProductPage } from "./puzzle-import-draft";

const empty: RawProductPage = { ogImages: [], jsonLdProducts: [] };
const SRC = "https://shop.example.com/p/1";

describe("extractPuzzleDraft", () => {
  it("prefers JSON-LD Product fields (tier 1)", () => {
    const raw: RawProductPage = {
      ...empty,
      ogTitle: "OG fallback title",
      ogImages: ["https://img/og.jpg"],
      jsonLdProducts: [
        {
          name: "Ravensburger Mountain Vista 1000 pieces",
          brand: "Ravensburger",
          description: "A scenic 1000 piece puzzle",
          image: "https://img/product.jpg",
          gtin13: "4005556150007",
        },
      ],
    };
    const d = extractPuzzleDraft(raw, SRC);
    expect(d.title).toBe("Ravensburger Mountain Vista");
    expect(d.brand).toBe("Ravensburger");
    // JSON-LD image is first; OG image appended after (deduped).
    expect(d.images).toEqual(["https://img/product.jpg", "https://img/og.jpg"]);
    expect(d.imageUrl).toBe("https://img/product.jpg");
    expect(d.imageUrl).toBe(d.images[0]);
    expect(d.ean).toBe("4005556150007");
    expect(d.upc).toBeUndefined();
    expect(d.pieceCount).toBe(1000);
    expect(d.sourceUrl).toBe(SRC);
  });

  it("falls back to OpenGraph then <title> (tiers 2-3)", () => {
    expect(
      extractPuzzleDraft(
        {
          ...empty,
          ogTitle: "OG Puzzle 500 stukjes",
          ogImages: ["https://img/og.jpg"],
        },
        SRC,
      ).title,
    ).toBe("OG");
    expect(
      extractPuzzleDraft({ ...empty, basicTitle: "Basic 750 Teile" }, SRC)
        .title,
    ).toBe("Basic");
  });

  it("parses multilingual piece counts incl. thousands separators", () => {
    const pc = (title: string) =>
      extractPuzzleDraft({ ...empty, basicTitle: title }, SRC).pieceCount;
    expect(pc("Puzzle 1000 pieces")).toBe(1000);
    expect(pc("Legpuzzel 1.000 stukjes")).toBe(1000);
    expect(pc("Puzzle 1,500 pcs")).toBe(1500);
    expect(pc("Puzzle 500 Teile")).toBe(500);
    expect(pc("Rompecabezas 2000 piezas")).toBe(2000);
    expect(pc("No count here")).toBeUndefined();
  });

  it("maps gtin12 to upc", () => {
    const d = extractPuzzleDraft(
      { ...empty, jsonLdProducts: [{ name: "X", gtin12: "036000291452" }] },
      SRC,
    );
    expect(d.upc).toBe("036000291452");
    expect(d.ean).toBeUndefined();
  });

  it("returns an empty title when nothing is extractable", () => {
    expect(extractPuzzleDraft(empty, SRC).title).toBe("");
  });

  it("collects multiple JSON-LD images then OG images, deduped, capped at 8", () => {
    const raw: RawProductPage = {
      ...empty,
      ogImages: [
        "https://img/og1.jpg",
        "https://img/product-a.jpg", // duplicate of JSON-LD; should be dropped
        "https://img/og2.jpg",
      ],
      jsonLdProducts: [
        {
          name: "Puzzle",
          image: ["https://img/product-a.jpg", "https://img/product-b.jpg"],
        },
      ],
    };
    const d = extractPuzzleDraft(raw, SRC);
    // JSON-LD images come first; OG images follow with duplicates removed.
    expect(d.images).toEqual([
      "https://img/product-a.jpg",
      "https://img/product-b.jpg",
      "https://img/og1.jpg",
      "https://img/og2.jpg",
    ]);
    expect(d.imageUrl).toBe(d.images[0]);
  });

  it("excludes non-http(s) URLs and imageUrl is undefined when no images present", () => {
    const d = extractPuzzleDraft(empty, SRC);
    expect(d.images).toEqual([]);
    expect(d.imageUrl).toBeUndefined();
  });
});

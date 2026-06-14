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

  // --- Targeted mutation-killing tests below ---

  const pcFromTitle = (title: string) =>
    extractPuzzleDraft({ ...empty, basicTitle: title }, SRC).pieceCount;

  describe("piece-count bounds (parsePieceCount L18)", () => {
    // Lower bound `n >= 1`: 0 must be rejected. Kills `n >= 1` -> true and the
    // `... || n <= 100000` logical mutant (which would let 0 through via the OR).
    it("rejects a zero count", () => {
      expect(pcFromTitle("Puzzle 0 pieces")).toBeUndefined();
    });

    // `n >= 1` boundary: exactly 1 must be ACCEPTED. Kills the `n > 1` equality mutant.
    it("accepts a count of exactly 1", () => {
      expect(pcFromTitle("Puzzle 1 piece")).toBe(1);
    });

    // Upper bound `n <= 100000` boundary: exactly 100000 must be ACCEPTED.
    // Kills the `n < 100000` equality mutant.
    it("accepts a count of exactly 100000", () => {
      expect(pcFromTitle("Puzzle 100000 pieces")).toBe(100000);
    });

    // Upper bound: above the cap must be rejected. Kills `n <= 100000` -> true and the
    // `Number.isFinite(n) || n >= 1` logical mutant (which drops the upper bound entirely).
    it("rejects a count above 100000", () => {
      expect(pcFromTitle("Puzzle 200000 pieces")).toBeUndefined();
    });
  });

  describe("piece-count regex (PIECE_COUNT_RE L12)", () => {
    // `\s` inside the digit class: a space-separated thousands group must parse.
    // Kills `[\d.,\S]` (which would no longer accept the space).
    it("parses space-separated thousands", () => {
      expect(pcFromTitle("Puzzle 10 000 pieces")).toBe(10000);
    });

    // `\s*` (zero-or-more) between number and unit: no space must still match.
    // Kills `\s` (exactly one required space).
    it("parses a count with no space before the unit", () => {
      expect(pcFromTitle("Puzzle 1000pieces")).toBe(1000);
    });

    // Optional trailing `s` in `pieces?`: singular "piece" must match.
    // Kills `pieces` (mandatory plural).
    it("parses a singular 'piece' unit", () => {
      expect(pcFromTitle("Puzzle 500 piece")).toBe(500);
    });

    // Second alternation `\d` (single-digit fallback): a lone digit + unit must match.
    // Kills `\D` in the second alternative.
    it("parses a single-digit count", () => {
      expect(pcFromTitle("Puzzle 5 pcs")).toBe(5);
    });

    // First-alternative trailing `\d`: a multi-digit count ending in a digit must parse
    // as a whole. Kills `\D` at the end of the first alternative (which would force the
    // single-digit fallback and mis-capture).
    it("parses a two-digit count keeping both digits", () => {
      expect(pcFromTitle("Puzzle 24 pieces")).toBe(24);
    });

    // French accented unit `pi[eè]ces`: "pièces" must match.
    // Kills `pi[^eè]ces` (negated class no longer matches è).
    it("parses the French accented 'pièces' unit", () => {
      expect(pcFromTitle("Casse-tête 1000 pièces")).toBe(1000);
    });
  });

  describe("image URL filtering (HTTP_RE L31 + typeof guard L40)", () => {
    // `^` anchor: a scheme embedded mid-string must NOT count as http(s).
    // Kills `/https?:\/\//` (no anchor), which would match "https://" inside the string.
    it("rejects a URL where http(s) appears only mid-string", () => {
      const d = extractPuzzleDraft(
        { ...empty, ogImages: ["data:https://evil/x.png"] },
        SRC,
      );
      expect(d.images).toEqual([]);
      expect(d.imageUrl).toBeUndefined();
    });

    // Optional `s` in `https?`: a plain http:// URL must be accepted.
    // Kills `/^https:\/\//` (https-only).
    it("accepts a plain http:// image URL", () => {
      const d = extractPuzzleDraft(
        { ...empty, ogImages: ["http://img/plain.jpg"] },
        SRC,
      );
      expect(d.images).toEqual(["http://img/plain.jpg"]);
    });

    // `typeof url === "string"` guard + the `&&` chain: a non-http string must be excluded.
    // Kills `typeof url === "string"` -> true and the `|| HTTP_RE.test(url)` logical mutant
    // (an OR would admit this string via the truthy typeof check).
    it("excludes a non-http(s) string URL such as ftp://", () => {
      const d = extractPuzzleDraft(
        { ...empty, ogImages: ["ftp://img/x.jpg", "https://img/ok.jpg"] },
        SRC,
      );
      expect(d.images).toEqual(["https://img/ok.jpg"]);
    });

    // `typeof url === "string"` guard against a non-string candidate (an ImageObject can
    // leak a non-string into the JSON-LD image array at runtime). A number must be excluded.
    // Kills the `typeof url === "string"` -> true conditional mutant.
    it("excludes a non-string image candidate", () => {
      const raw = {
        ...empty,
        jsonLdProducts: [
          {
            name: "Puzzle",
            // Deliberately malformed: a non-string slips into the image array.
            image: [42 as unknown as string, "https://img/ok.jpg"],
          },
        ],
      } as RawProductPage;
      const d = extractPuzzleDraft(raw, SRC);
      expect(d.images).toEqual(["https://img/ok.jpg"]);
    });
  });

  describe("toImageArray null handling (L24)", () => {
    // When the JSON-LD product has no image, only the OG images survive — never a sentinel
    // or an `undefined` entry. Kills `if (image == null)` -> false (which yields `[undefined]`)
    // and the `["Stryker was here"]` array-declaration mutant.
    it("uses only OG images when the product has no image field", () => {
      const d = extractPuzzleDraft(
        {
          ...empty,
          ogImages: ["https://img/og.jpg"],
          jsonLdProducts: [{ name: "Puzzle" }],
        },
        SRC,
      );
      expect(d.images).toEqual(["https://img/og.jpg"]);
      expect(d.images).not.toContain("Stryker was here");
      expect(d.images.every((u) => typeof u === "string")).toBe(true);
    });
  });

  describe("image cap (result.length < MAX_IMAGES L43)", () => {
    // Exactly 9 distinct http images: only the first 8 are kept (cap is 8).
    // Kills `< MAX_IMAGES` -> `<= MAX_IMAGES` (would keep 9) and `-> true` (no cap).
    it("caps the image list at 8 and drops the 9th", () => {
      const nine = Array.from({ length: 9 }, (_, i) => `https://img/${i}.jpg`);
      const d = extractPuzzleDraft({ ...empty, ogImages: nine }, SRC);
      expect(d.images).toHaveLength(8);
      expect(d.images).toEqual(nine.slice(0, 8));
      expect(d.images).not.toContain("https://img/8.jpg");
    });
  });

  describe("gtin length-based barcode mapping (L57 / L60)", () => {
    // A 13-char `gtin` (no explicit gtin13) maps to ean. Kills `gtin?.length === 13` -> false.
    it("maps a 13-digit gtin to ean", () => {
      const d = extractPuzzleDraft(
        { ...empty, jsonLdProducts: [{ name: "X", gtin: "4005556150007" }] },
        SRC,
      );
      expect(d.ean).toBe("4005556150007");
      expect(d.upc).toBeUndefined();
    });

    // A 12-char `gtin` (no explicit gtin12) maps to upc. Kills `gtin?.length === 12` -> false.
    it("maps a 12-digit gtin to upc", () => {
      const d = extractPuzzleDraft(
        { ...empty, jsonLdProducts: [{ name: "X", gtin: "036000291452" }] },
        SRC,
      );
      expect(d.upc).toBe("036000291452");
      expect(d.ean).toBeUndefined();
    });

    // A gtin of some other length maps to neither (guards that the length checks are real).
    it("ignores a gtin of non-12/13 length", () => {
      const d = extractPuzzleDraft(
        { ...empty, jsonLdProducts: [{ name: "X", gtin: "12345" }] },
        SRC,
      );
      expect(d.ean).toBeUndefined();
      expect(d.upc).toBeUndefined();
    });
  });

  describe("clean() trimming (L65)", () => {
    // Surrounding whitespace on brand must be trimmed. Kills `value?.trim()` -> `value`.
    it("trims surrounding whitespace from brand", () => {
      const d = extractPuzzleDraft(
        {
          ...empty,
          jsonLdProducts: [{ name: "Puzzle", brand: "  Ravensburger  " }],
        },
        SRC,
      );
      expect(d.brand).toBe("Ravensburger");
    });

    // A whitespace-only brand collapses to undefined (trimmed -> "" -> undefined).
    // Also kills `value?.trim()` -> `value` (which leaves a truthy "   " and returns it).
    it("treats a whitespace-only brand as undefined", () => {
      const d = extractPuzzleDraft(
        { ...empty, jsonLdProducts: [{ name: "Puzzle", brand: "   " }] },
        SRC,
      );
      expect(d.brand).toBeUndefined();
    });

    // Surrounding whitespace on description must be trimmed.
    it("trims surrounding whitespace from description", () => {
      const d = extractPuzzleDraft(
        {
          ...empty,
          jsonLdProducts: [{ name: "Puzzle", description: "  A nice scene  " }],
        },
        SRC,
      );
      expect(d.description).toBe("A nice scene");
    });
  });

  describe("description tier fallback (?? chain L84)", () => {
    // Only basicDescription present: description must equal it.
    // Kills `(product?.description ?? raw.ogDescription) && raw.basicDescription`
    // (the AND yields undefined because the left side is undefined).
    it("falls back to basicDescription when higher tiers are absent", () => {
      const d = extractPuzzleDraft(
        { ...empty, basicTitle: "T", basicDescription: "Basic desc" },
        SRC,
      );
      expect(d.description).toBe("Basic desc");
    });

    // Only ogDescription present: description must equal it.
    // Kills `product?.description && raw.ogDescription`
    // (the AND yields undefined because product description is absent).
    it("falls back to ogDescription when product description is absent", () => {
      const d = extractPuzzleDraft(
        { ...empty, ogTitle: "T", ogDescription: "OG desc" },
        SRC,
      );
      expect(d.description).toBe("OG desc");
    });

    // Product description wins over the lower tiers.
    it("prefers the product description over og/basic", () => {
      const d = extractPuzzleDraft(
        {
          ...empty,
          ogDescription: "OG desc",
          basicDescription: "Basic desc",
          jsonLdProducts: [{ name: "P", description: "Product desc" }],
        },
        SRC,
      );
      expect(d.description).toBe("Product desc");
    });
  });

  describe("piece-count parsed across title AND description (L89)", () => {
    // The count lives ONLY in the description; it must still be found because the parser
    // runs over `${rawTitle} ${description}`. Kills `description ?? ""` -> `description && ""`
    // (the AND collapses the description to "" and the count is lost).
    it("finds the piece count when it is only in the description", () => {
      const d = extractPuzzleDraft(
        {
          ...empty,
          basicTitle: "Mountain Scene",
          basicDescription: "Beautiful 1500 pieces jigsaw",
        },
        SRC,
      );
      expect(d.pieceCount).toBe(1500);
    });
  });

  describe("imageAlts (pickAlts)", () => {
    it("carries alt text for surviving images, keyed by URL", () => {
      const d = extractPuzzleDraft(
        {
          ...empty,
          ogImages: ["https://img/a.jpg", "https://img/b.jpg"],
          imageAlts: {
            "https://img/a.jpg": "Box front",
            "https://img/b.jpg": "Box back",
          },
        },
        SRC,
      );
      expect(d.imageAlts).toEqual({
        "https://img/a.jpg": "Box front",
        "https://img/b.jpg": "Box back",
      });
    });

    it("drops alt entries whose image was filtered out (non-http / capped)", () => {
      // The ftp URL is dropped from `images`, so its alt must not appear in the draft.
      const d = extractPuzzleDraft(
        {
          ...empty,
          ogImages: ["ftp://img/bad.jpg", "https://img/ok.jpg"],
          imageAlts: {
            "ftp://img/bad.jpg": "Dropped",
            "https://img/ok.jpg": "Kept",
          },
        },
        SRC,
      );
      expect(d.images).toEqual(["https://img/ok.jpg"]);
      expect(d.imageAlts).toEqual({ "https://img/ok.jpg": "Kept" });
    });

    it("is undefined when the page carries no alt map", () => {
      const d = extractPuzzleDraft(
        { ...empty, ogImages: ["https://img/a.jpg"] },
        SRC,
      );
      expect(d.imageAlts).toBeUndefined();
    });

    it("is undefined when no surviving image has alt text", () => {
      const d = extractPuzzleDraft(
        {
          ...empty,
          ogImages: ["https://img/a.jpg"],
          imageAlts: { "https://img/other.jpg": "Not in the set" },
        },
        SRC,
      );
      expect(d.imageAlts).toBeUndefined();
    });
  });
});

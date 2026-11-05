import { describe, expect, it } from "vitest";
import {
  computeCollectionBreakdown,
  OTHER_BUCKET,
  UNKNOWN_BUCKET,
  type CopyBreakdownInput,
} from "./collection-breakdown";

const copy = (over: Partial<CopyBreakdownInput>): CopyBreakdownInput => ({
  ...over,
});

describe("computeCollectionBreakdown", () => {
  it("names its unknown and long-tail buckets with sentinels, never with English words", () => {
    // The web translates these two strings; they are part of the query's wire contract.
    expect(UNKNOWN_BUCKET).toBe("__unknown");
    expect(OTHER_BUCKET).toBe("__other");
  });

  it("returns empty distributions for no copies", () => {
    expect(computeCollectionBreakdown([])).toEqual({
      byPieceCount: [],
      byBrand: [],
      byDifficulty: [],
      byCondition: [],
    });
  });

  describe("piece-count bucketing", () => {
    it("places counts at the inclusive-lower / exclusive-upper bucket edges", () => {
      const { byPieceCount } = computeCollectionBreakdown([
        copy({ pieceCount: 99 }), // < 100
        copy({ pieceCount: 100 }), // 100-299 (lower edge)
        copy({ pieceCount: 299 }), // 100-299 (upper edge)
        copy({ pieceCount: 300 }), // 300-499 (lower edge)
        copy({ pieceCount: 500 }), // 500-999
        copy({ pieceCount: 999 }), // 500-999
        copy({ pieceCount: 1000 }), // 1000-1999
        copy({ pieceCount: 2000 }), // 2000+
      ]);
      expect(byPieceCount).toEqual([
        { label: "< 100", value: 1 },
        { label: "100-299", value: 2 },
        { label: "300-499", value: 1 },
        { label: "500-999", value: 2 },
        { label: "1000-1999", value: 1 },
        { label: "2000+", value: 1 },
      ]);
    });

    it("emits buckets in ascending range order and drops empty buckets", () => {
      const { byPieceCount } = computeCollectionBreakdown([
        copy({ pieceCount: 2500 }),
        copy({ pieceCount: 50 }),
      ]);
      expect(byPieceCount.map((e) => e.label)).toEqual(["< 100", "2000+"]);
    });

    it("buckets missing or non-finite piece counts as unknown, listed last", () => {
      const { byPieceCount } = computeCollectionBreakdown([
        copy({ pieceCount: 500 }),
        copy({ pieceCount: undefined }),
        copy({ pieceCount: Number.NaN }),
        // Infinity satisfies `>= 2000`, so only the finite guard keeps it out of the 2000+ bucket.
        copy({ pieceCount: Number.POSITIVE_INFINITY }),
      ]);
      expect(byPieceCount).toEqual([
        { label: "500-999", value: 1 },
        { label: UNKNOWN_BUCKET, value: 3 },
      ]);
    });
  });

  describe("facet distributions (difficulty / condition)", () => {
    it("counts values, sorting by value desc then label asc", () => {
      const { byDifficulty } = computeCollectionBreakdown([
        copy({ difficulty: "hard" }),
        copy({ difficulty: "easy" }),
        copy({ difficulty: "easy" }),
        copy({ difficulty: "medium" }),
      ]);
      expect(byDifficulty).toEqual([
        { label: "easy", value: 2 },
        { label: "hard", value: 1 },
        { label: "medium", value: 1 },
      ]);
    });

    it("maps missing or blank values to the unknown bucket, listed last even when largest", () => {
      const { byCondition } = computeCollectionBreakdown([
        copy({ condition: "good" }),
        copy({ condition: undefined }),
        copy({ condition: "   " }),
      ]);
      expect(byCondition).toEqual([
        { label: "good", value: 1 },
        { label: UNKNOWN_BUCKET, value: 2 },
      ]);
    });

    it("leaves the unknown bucket out when every copy has a value", () => {
      const { byDifficulty } = computeCollectionBreakdown([
        copy({ difficulty: "easy" }),
      ]);
      expect(byDifficulty).toEqual([{ label: "easy", value: 1 }]);
    });
  });

  describe("brand top-N with Other collapse", () => {
    const brandCopies = (
      counts: Record<string, number>,
    ): CopyBreakdownInput[] =>
      Object.entries(counts).flatMap(([brand, n]) =>
        Array.from({ length: n }, () => copy({ brand })),
      );

    it("keeps every brand when distinct brands <= topN (no Other)", () => {
      const { byBrand } = computeCollectionBreakdown(
        brandCopies({ A: 3, B: 1 }),
        2,
      );
      expect(byBrand).toEqual([
        { label: "A", value: 3 },
        { label: "B", value: 1 },
      ]);
      expect(byBrand.some((e) => e.label === OTHER_BUCKET)).toBe(false);
    });

    it("collapses the tail beyond topN into a single Other appended last", () => {
      const { byBrand } = computeCollectionBreakdown(
        brandCopies({ A: 5, B: 4, C: 3, D: 2, E: 1 }),
        2,
      );
      expect(byBrand).toEqual([
        { label: "A", value: 5 },
        { label: "B", value: 4 },
        // C + D + E folded into Other.
        { label: OTHER_BUCKET, value: 6 },
      ]);
      expect(byBrand[byBrand.length - 1]?.label).toBe(OTHER_BUCKET);
    });

    it("does not collapse when distinct brands exactly equal topN", () => {
      const { byBrand } = computeCollectionBreakdown(
        brandCopies({ A: 2, B: 2 }),
        2,
      );
      expect(byBrand.some((e) => e.label === OTHER_BUCKET)).toBe(false);
      expect(byBrand).toHaveLength(2);
    });

    it("ranks only real brands: copies without one never take a top-N slot", () => {
      const { byBrand } = computeCollectionBreakdown(
        [
          ...brandCopies({ A: 1, B: 1 }),
          copy({ brand: undefined }),
          copy({ brand: undefined }),
          copy({ brand: "  " }),
        ],
        2,
      );
      expect(byBrand).toEqual([
        { label: "A", value: 1 },
        { label: "B", value: 1 },
        { label: UNKNOWN_BUCKET, value: 3 },
      ]);
    });

    it("lists the unknown bucket after Other", () => {
      const { byBrand } = computeCollectionBreakdown(
        [
          ...brandCopies({ A: 5, B: 4, C: 3 }),
          ...Array.from({ length: 9 }, () => copy({})),
        ],
        2,
      );
      expect(byBrand).toEqual([
        { label: "A", value: 5 },
        { label: "B", value: 4 },
        { label: OTHER_BUCKET, value: 3 },
        { label: UNKNOWN_BUCKET, value: 9 },
      ]);
    });

    it("keeps the six biggest brands by default, the chart's series cap", () => {
      const { byBrand } = computeCollectionBreakdown(
        brandCopies({ A: 7, B: 6, C: 5, D: 4, E: 3, F: 2, G: 1 }),
      );
      expect(byBrand).toEqual([
        { label: "A", value: 7 },
        { label: "B", value: 6 },
        { label: "C", value: 5 },
        { label: "D", value: 4 },
        { label: "E", value: 3 },
        { label: "F", value: 2 },
        { label: OTHER_BUCKET, value: 1 },
      ]);
    });
  });
});

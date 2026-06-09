import { describe, expect, it } from "vitest";
import {
  type CopyBreakdownInput,
  computeCollectionBreakdown,
} from "./collection-breakdown";

const copy = (over: Partial<CopyBreakdownInput>): CopyBreakdownInput => ({ ...over });

describe("computeCollectionBreakdown", () => {
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

    it("buckets missing or non-finite piece counts as Unknown, listed last", () => {
      const { byPieceCount } = computeCollectionBreakdown([
        copy({ pieceCount: 500 }),
        copy({ pieceCount: undefined }),
        copy({ pieceCount: Number.NaN }),
      ]);
      expect(byPieceCount).toEqual([
        { label: "500-999", value: 1 },
        { label: "Unknown", value: 2 },
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

    it("maps missing or blank values to Unknown", () => {
      const { byCondition } = computeCollectionBreakdown([
        copy({ condition: "good" }),
        copy({ condition: undefined }),
        copy({ condition: "   " }),
      ]);
      expect(byCondition).toEqual([
        { label: "Unknown", value: 2 },
        { label: "good", value: 1 },
      ]);
    });
  });

  describe("brand top-N with Other collapse", () => {
    const brandCopies = (counts: Record<string, number>): CopyBreakdownInput[] =>
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
      expect(byBrand.some((e) => e.label === "Other")).toBe(false);
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
        { label: "Other", value: 6 },
      ]);
      expect(byBrand[byBrand.length - 1]?.label).toBe("Other");
    });

    it("does not collapse when distinct brands exactly equal topN", () => {
      const { byBrand } = computeCollectionBreakdown(
        brandCopies({ A: 2, B: 2 }),
        2,
      );
      expect(byBrand.some((e) => e.label === "Other")).toBe(false);
      expect(byBrand).toHaveLength(2);
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  type CandidatePuzzle,
  type MemberSignals,
  recommendPuzzles,
} from "./recommendations";

const signals = (facets: MemberSignals["facets"]): MemberSignals => ({
  facets,
});

const candidate = (
  over: Partial<CandidatePuzzle> & { key: string },
): CandidatePuzzle => ({
  ...over,
});

describe("recommendPuzzles", () => {
  it("returns empty for no candidates", () => {
    expect(recommendPuzzles({ signals: signals([]), candidates: [] })).toEqual(
      [],
    );
  });

  describe("facet affinity", () => {
    it("scores same-brand candidates highest and reports sameBrand", () => {
      const result = recommendPuzzles({
        signals: signals([{ brand: "Ravensburger", pieceCount: 1000 }]),
        candidates: [
          candidate({
            key: "same-brand",
            brand: "Ravensburger",
            pieceCount: 50,
          }),
          candidate({
            key: "same-band",
            brand: "Clementoni",
            pieceCount: 1500,
          }),
        ],
      });
      expect(result[0]).toEqual({
        key: "same-brand",
        score: 3,
        reason: "sameBrand",
      });
      expect(result[1]).toEqual({
        key: "same-band",
        score: 1,
        reason: "similarPieceCount",
      });
    });

    it("scores similar piece-count band and reports similarPieceCount", () => {
      const result = recommendPuzzles({
        signals: signals([{ pieceCount: 600 }]),
        candidates: [
          // 999 is the same 500-999 band as the owned 600; 1000 crosses into the next band.
          candidate({ key: "near", pieceCount: 999 }),
          candidate({ key: "far", pieceCount: 1000 }),
        ],
      });
      expect(result[0]).toEqual({
        key: "near",
        score: 1,
        reason: "similarPieceCount",
      });
      expect(result[1]?.key).toBe("far");
      expect(result[1]?.score).toBe(0);
    });

    it("scores shared category/tag overlap and reports sharedCategory", () => {
      const result = recommendPuzzles({
        signals: signals([{ categoryKeys: ["landscape", "nature"] }]),
        candidates: [
          candidate({ key: "overlap", categoryKeys: ["nature"] }),
          candidate({ key: "disjoint", categoryKeys: ["abstract"] }),
        ],
      });
      expect(result[0]).toEqual({
        key: "overlap",
        score: 2,
        reason: "sharedCategory",
      });
      expect(result[1]?.score).toBe(0);
    });

    it("sums overlapping facets and reports the strongest (brand > category > pieces)", () => {
      const result = recommendPuzzles({
        signals: signals([
          { brand: "Ravensburger", pieceCount: 1000, categoryKeys: ["nature"] },
        ]),
        candidates: [
          candidate({
            key: "triple",
            brand: "Ravensburger",
            pieceCount: 1500,
            categoryKeys: ["nature"],
          }),
        ],
      });
      // brand 3 + category 2 + piece band 1 = 6, dominant facet is brand.
      expect(result[0]).toEqual({
        key: "triple",
        score: 6,
        reason: "sameBrand",
      });
    });

    it("normalises brand and category casing/whitespace", () => {
      const result = recommendPuzzles({
        signals: signals([
          { brand: " Ravensburger ", categoryKeys: ["Nature"] },
        ]),
        candidates: [
          candidate({
            key: "match",
            brand: "ravensburger",
            categoryKeys: ["nature"],
          }),
        ],
      });
      expect(result[0]).toEqual({
        key: "match",
        score: 5,
        reason: "sameBrand",
      });
    });

    it("weights affinity by presence, not multiplicity (a recurring brand still matches)", () => {
      const result = recommendPuzzles({
        signals: signals([
          { brand: "Ravensburger" },
          { brand: "Ravensburger" },
          { brand: "Ravensburger" },
        ]),
        candidates: [candidate({ key: "rav", brand: "Ravensburger" })],
      });
      expect(result[0]?.reason).toBe("sameBrand");
      expect(result[0]?.score).toBe(3);
    });
  });

  describe("owned exclusion", () => {
    it("excludes candidates whose key is in ownedKeys", () => {
      const result = recommendPuzzles({
        signals: signals([{ brand: "Ravensburger" }]),
        candidates: [
          candidate({ key: "owned", brand: "Ravensburger" }),
          candidate({ key: "new", brand: "Ravensburger" }),
        ],
        ownedKeys: ["owned"],
      });
      expect(result.map((r) => r.key)).toEqual(["new"]);
    });

    it("matches ownedKeys case-insensitively", () => {
      const result = recommendPuzzles({
        signals: signals([]),
        candidates: [candidate({ key: "ABC", popularity: 5 })],
        ownedKeys: ["abc"],
      });
      expect(result).toEqual([]);
    });

    it("drops candidates with an empty key", () => {
      const result = recommendPuzzles({
        signals: signals([]),
        candidates: [
          candidate({ key: "", popularity: 9 }),
          candidate({ key: "ok" }),
        ],
      });
      expect(result.map((r) => r.key)).toEqual(["ok"]);
    });
  });

  describe("popularity", () => {
    it("falls back to popularity ordering when the member has no signals", () => {
      const result = recommendPuzzles({
        signals: signals([]),
        candidates: [
          candidate({ key: "low", popularity: 1 }),
          candidate({ key: "high", popularity: 100 }),
          candidate({ key: "mid", popularity: 10 }),
        ],
      });
      expect(result.map((r) => r.key)).toEqual(["high", "mid", "low"]);
      expect(result.every((r) => r.reason === "popular")).toBe(true);
    });

    it("uses popularity only as a sub-point tiebreak, never overtaking a facet tier", () => {
      const result = recommendPuzzles({
        signals: signals([{ brand: "Ravensburger" }]),
        candidates: [
          // No facet match but very popular...
          candidate({ key: "popular-nomatch", popularity: 1000 }),
          // ...still ranks below a weakest-tier facet match with zero popularity.
          candidate({
            key: "weak-facet",
            pieceCount: undefined,
            brand: "Ravensburger",
          }),
        ],
      });
      expect(result[0]?.key).toBe("weak-facet");
      expect(result[0]?.score).toBeGreaterThanOrEqual(3);
      expect(result[1]?.key).toBe("popular-nomatch");
      expect(result[1]?.score).toBeLessThan(1);
    });

    it("breaks facet-score ties by popularity", () => {
      const result = recommendPuzzles({
        signals: signals([{ brand: "Ravensburger" }]),
        candidates: [
          candidate({ key: "a", brand: "Ravensburger", popularity: 5 }),
          candidate({ key: "b", brand: "Ravensburger", popularity: 50 }),
        ],
      });
      expect(result.map((r) => r.key)).toEqual(["b", "a"]);
    });
  });

  describe("deterministic tie ordering", () => {
    it("breaks full ties by recencyRank (newer first) then key", () => {
      const result = recommendPuzzles({
        signals: signals([]),
        candidates: [
          candidate({ key: "z", popularity: 5, recencyRank: 2 }),
          candidate({ key: "a", popularity: 5, recencyRank: 1 }),
          candidate({ key: "m", popularity: 5 }),
        ],
      });
      // Equal popularity -> recencyRank 1 then 2, then the rankless candidate, then by key.
      expect(result.map((r) => r.key)).toEqual(["a", "z", "m"]);
    });

    it("is order-independent given identical inputs in a different order", () => {
      const cands = [
        candidate({ key: "a", brand: "X", popularity: 5 }),
        candidate({ key: "b", brand: "X", popularity: 5 }),
        candidate({ key: "c", brand: "X", popularity: 5 }),
      ];
      const s = signals([{ brand: "X" }]);
      const forward = recommendPuzzles({ signals: s, candidates: cands });
      const reversed = recommendPuzzles({
        signals: s,
        candidates: [...cands].reverse(),
      });
      expect(forward).toEqual(reversed);
    });
  });

  describe("limit", () => {
    it("caps the result to limit, keeping the highest-scored", () => {
      const result = recommendPuzzles({
        signals: signals([{ brand: "Ravensburger" }]),
        candidates: [
          candidate({ key: "match-a", brand: "Ravensburger", popularity: 9 }),
          candidate({ key: "match-b", brand: "Ravensburger", popularity: 8 }),
          candidate({ key: "nomatch", popularity: 100 }),
        ],
        limit: 2,
      });
      expect(result.map((r) => r.key)).toEqual(["match-a", "match-b"]);
    });

    it("returns all when limit <= 0 or omitted", () => {
      const cands = [
        candidate({ key: "a", popularity: 2 }),
        candidate({ key: "b", popularity: 1 }),
      ];
      expect(
        recommendPuzzles({ signals: signals([]), candidates: cands, limit: 0 }),
      ).toHaveLength(2);
      expect(
        recommendPuzzles({ signals: signals([]), candidates: cands }),
      ).toHaveLength(2);
    });
  });

  // Two piece counts share a band iff a candidate at one earns the +1 similarPieceCount point from a
  // sole owner-signal at the other (no other facet in play), so this probes the band partition.
  const sameBand = (ownedPieces: number, candidatePieces: number): boolean => {
    const result = recommendPuzzles({
      signals: signals([{ pieceCount: ownedPieces }]),
      candidates: [candidate({ key: "c", pieceCount: candidatePieces })],
    });
    return result[0]?.reason === "similarPieceCount" && result[0]?.score === 1;
  };

  describe("piece-count band boundaries (inclusive-lower / exclusive-upper)", () => {
    it("partitions piece counts into the right band at every boundary", () => {
      expect(sameBand(50, 99)).toBe(true);
      expect(sameBand(50, 100)).toBe(false);
      expect(sameBand(100, 299)).toBe(true);
      expect(sameBand(100, 300)).toBe(false);
      expect(sameBand(300, 499)).toBe(true);
      expect(sameBand(300, 500)).toBe(false);
      expect(sameBand(500, 999)).toBe(true);
      expect(sameBand(500, 1000)).toBe(false);
      expect(sameBand(1000, 1999)).toBe(true);
      expect(sameBand(1000, 2000)).toBe(false);
      expect(sameBand(2000, 5000)).toBe(true);
    });

    it("never bands a non-finite piece count (NaN/Infinity contribute none)", () => {
      expect(sameBand(Number.NaN, Number.NaN)).toBe(false);
      expect(sameBand(1000, Number.POSITIVE_INFINITY)).toBe(false);
      expect(sameBand(Number.NaN, 1000)).toBe(false);
    });
  });

  describe("category key normalisation", () => {
    it("matches keys after trimming and lower-casing both sides", () => {
      const result = recommendPuzzles({
        signals: signals([{ categoryKeys: ["  Nature  ", "LANDSCAPE"] }]),
        candidates: [candidate({ key: "c", categoryKeys: ["nature"] })],
      });
      expect(result[0]).toEqual({
        key: "c",
        score: 2,
        reason: "sharedCategory",
      });
    });

    it("drops blank category keys (an empty key is not a shared category)", () => {
      const result = recommendPuzzles({
        signals: signals([{ categoryKeys: ["nature", "  "] }]),
        candidates: [candidate({ key: "blank", categoryKeys: ["  "] })],
      });
      expect(result[0]?.score).toBe(0);
      expect(result[0]?.reason).toBe("popular");
    });
  });

  it("reports popular when signals exist but a candidate shares no facet", () => {
    const result = recommendPuzzles({
      signals: signals([{ brand: "Ravensburger" }]),
      candidates: [
        candidate({ key: "nomatch", brand: "Clementoni", popularity: 3 }),
      ],
    });
    expect(result[0]?.reason).toBe("popular");
  });

  describe("popularity tiebreak scoring", () => {
    it("adds a sub-1 tiebreak; the most-popular candidate scores ~0.999", () => {
      const result = recommendPuzzles({
        signals: signals([]),
        candidates: [candidate({ key: "p", popularity: 10 })],
      });
      expect(result[0]?.score).toBeCloseTo(0.999, 6);
    });

    it("ignores non-positive popularity (a negative count adds no tiebreak)", () => {
      const result = recommendPuzzles({
        signals: signals([]),
        candidates: [
          candidate({ key: "pos", popularity: 10 }),
          candidate({ key: "neg", popularity: -5 }),
        ],
      });
      expect(result.find((r) => r.key === "neg")?.score).toBe(0);
    });
  });

  it("excludes an owned candidate even when its key has surrounding whitespace", () => {
    const result = recommendPuzzles({
      signals: signals([]),
      candidates: [candidate({ key: "  abc  ", popularity: 5 })],
      ownedKeys: ["abc"],
    });
    expect(result).toEqual([]);
  });
});

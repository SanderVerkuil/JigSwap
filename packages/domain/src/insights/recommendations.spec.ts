import { describe, expect, it } from "vitest";
import {
  type CandidatePuzzle,
  type MemberSignals,
  recommendPuzzles,
} from "./recommendations";

const signals = (facets: MemberSignals["facets"]): MemberSignals => ({ facets });

const candidate = (over: Partial<CandidatePuzzle> & { key: string }): CandidatePuzzle => ({
  ...over,
});

describe("recommendPuzzles", () => {
  it("returns empty for no candidates", () => {
    expect(recommendPuzzles({ signals: signals([]), candidates: [] })).toEqual([]);
  });

  describe("facet affinity", () => {
    it("scores same-brand candidates highest and reports sameBrand", () => {
      const result = recommendPuzzles({
        signals: signals([{ brand: "Ravensburger", pieceCount: 1000 }]),
        candidates: [
          candidate({ key: "same-brand", brand: "Ravensburger", pieceCount: 50 }),
          candidate({ key: "same-band", brand: "Clementoni", pieceCount: 1500 }),
        ],
      });
      expect(result[0]).toEqual({ key: "same-brand", score: 3, reason: "sameBrand" });
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
      expect(result[0]).toEqual({ key: "near", score: 1, reason: "similarPieceCount" });
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
      expect(result[0]).toEqual({ key: "overlap", score: 2, reason: "sharedCategory" });
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
      expect(result[0]).toEqual({ key: "triple", score: 6, reason: "sameBrand" });
    });

    it("normalises brand and category casing/whitespace", () => {
      const result = recommendPuzzles({
        signals: signals([{ brand: " Ravensburger ", categoryKeys: ["Nature"] }]),
        candidates: [
          candidate({ key: "match", brand: "ravensburger", categoryKeys: ["nature"] }),
        ],
      });
      expect(result[0]).toEqual({ key: "match", score: 5, reason: "sameBrand" });
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
        candidates: [candidate({ key: "", popularity: 9 }), candidate({ key: "ok" })],
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
          candidate({ key: "weak-facet", pieceCount: undefined, brand: "Ravensburger" }),
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
      const reversed = recommendPuzzles({ signals: s, candidates: [...cands].reverse() });
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
      expect(recommendPuzzles({ signals: signals([]), candidates: cands, limit: 0 })).toHaveLength(2);
      expect(recommendPuzzles({ signals: signals([]), candidates: cands })).toHaveLength(2);
    });
  });
});

import type { PlankPuzzleView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";

// Bounded candidate scan: same guard as getRecommendations — never an unbounded table scan. The
// plank decorates the marketing hero so a 200-row window is more than enough to look varied.
const CANDIDATE_SCAN_LIMIT = 200;

// Marketing decoration: cap the caller's requested count so one bad URL param can't bloat the response.
const LIMIT_MIN = 1;
const LIMIT_MAX = 12;

// mulberry32 — a tiny, fast, seedable 32-bit PRNG (public domain). Returns a generator function
// that produces the next float in [0, 1) on each call. Deterministic per seed so Convex's
// reactivity model is satisfied (same inputs → same output for a given DB state).
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

// Partial Fisher-Yates: shuffle only the first `limit` slots so we pay O(limit) not O(n).
// Mutates `arr` in-place and returns it for convenience.
function partialShuffle<T>(arr: T[], limit: number, rand: () => number): T[] {
  const n = arr.length;
  const picks = Math.min(limit, n);
  for (let i = 0; i < picks; i++) {
    const j = i + Math.floor(rand() * (n - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Pure mapper: convert a puzzles row + resolved URL to the minimal marketing DTO. No moderation
// fields, no timestamps — only what the hero plank needs to render a cover card.
export const toPlankPuzzleView = (
  row: Doc<"puzzles">,
  image: string | null,
): PlankPuzzleView => ({
  title: row.title,
  pieceCount: row.pieceCount,
  brand: row.brand,
  image,
});

// Insights read (public, no auth): seeded-random sample of approved catalog puzzles for the
// marketing landing hero. `limit` is clamped to [1, 12]; `seed` drives a deterministic PRNG so
// the same (seed, DB state) always returns the same order. Bounded pool of the 200 most-recent
// approved definitions; partial Fisher-Yates picks `limit` items without shuffling the rest.
export const getPlankPuzzles = query({
  args: {
    limit: v.number(),
    seed: v.number(),
  },
  handler: async (ctx, args): Promise<PlankPuzzleView[]> => {
    const limit = Math.max(
      LIMIT_MIN,
      Math.min(LIMIT_MAX, Math.trunc(args.limit)),
    );

    // Bounded pool: most-recent approved catalog definitions (no auth required — status filter
    // ensures pending/rejected submissions never surface on the public page).
    const pool = await ctx.db
      .query("puzzles")
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "approved"))
      .take(CANDIDATE_SCAN_LIMIT);

    // Partial shuffle in-place; pool is a fresh array from .take() so mutation is safe.
    const rand = mulberry32(args.seed);
    const picked = partialShuffle(pool, limit, rand).slice(0, limit);

    // Resolve storage IDs to public URLs concurrently.
    return Promise.all(
      picked.map(async (puzzle) =>
        toPlankPuzzleView(
          puzzle,
          puzzle.image != null ? await ctx.storage.getUrl(puzzle.image) : null,
        ),
      ),
    );
  },
});

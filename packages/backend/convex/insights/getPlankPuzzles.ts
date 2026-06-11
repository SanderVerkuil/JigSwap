import type { PlankPuzzleView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { mulberry32, partialShuffle } from "./sampling";

// Bounded candidate scan: same guard as getRecommendations — never an unbounded table scan. The
// plank decorates the marketing hero so a 200-row window is more than enough to look varied.
const CANDIDATE_SCAN_LIMIT = 200;

// Marketing decoration: cap the caller's requested count so one bad URL param can't bloat the response.
const LIMIT_MIN = 1;
const LIMIT_MAX = 12;

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

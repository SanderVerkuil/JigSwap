import type { PlankPuzzleView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import type { ImageSources } from "../lib/imageModeration/imageSources";
import { clampLimit } from "../lib/pageSize";
import { mulberry32, partialShuffle } from "./sampling";

// Bounded candidate scan: same guard as getRecommendations — never an unbounded table scan. The
// plank decorates the marketing hero so a 200-row window is more than enough to look varied.
const CANDIDATE_SCAN_LIMIT = 200;

// Marketing decoration: cap the caller's requested count so one bad URL param can't bloat the response.
const LIMIT_MAX = 12;

// Pure mapper: convert a puzzles row + resolved image to the minimal marketing DTO. No moderation
// fields, no timestamps — only what the hero plank needs to render a cover card. The plank draws
// covers as small textures, so it gets the 480 px rendition (`thumbUrl`) when there is one.
export const toPlankPuzzleView = (
  row: Doc<"puzzles">,
  image: ImageSources | null,
): PlankPuzzleView => ({
  title: row.title,
  pieceCount: row.pieceCount,
  brand: row.brand,
  image: image?.url ?? null,
  ...(image?.thumbUrl !== undefined && { thumbUrl: image.thumbUrl }),
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
    const limit = clampLimit(args.limit, {
      fallback: LIMIT_MAX,
      max: LIMIT_MAX,
    });

    // Bounded pool: most-recent approved catalog definitions (no auth required — reading through
    // the by_status index ensures pending/rejected submissions never surface on the public page).
    const pool = await ctx.db
      .query("puzzles")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(CANDIDATE_SCAN_LIMIT);

    // Partial shuffle in-place; pool is a fresh array from .take() so mutation is safe.
    const rand = mulberry32(args.seed);
    const picked = partialShuffle(pool, limit, rand).slice(0, limit);

    // Resolve storage IDs to public URLs concurrently.
    return Promise.all(
      picked.map(async (puzzle) =>
        toPlankPuzzleView(puzzle, await boxArtImage(ctx, puzzle.image)),
      ),
    );
  },
});

import {
  type CandidatePuzzle,
  type PuzzleFacets,
  recommendPuzzles,
} from "@jigswap/domain";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Bounded candidate scan: Insights is read-only and must never run an unbounded table scan, so we
// take at most this many of the most-recent approved catalog definitions as the candidate pool. The
// pure projection ranks within this window; raising the cap is a deliberate cost trade-off.
const CANDIDATE_SCAN_LIMIT = 300;
// How many ranked recommendations the UI card needs.
const RESULT_LIMIT = 12;

// Reduce a puzzle row to the facets the recommendation projection scores on. `categoryKeys` folds
// the category id and tag keys into one comparable set.
const facetsOf = (puzzle: Doc<"puzzles">): PuzzleFacets => ({
  brand: puzzle.brand,
  pieceCount: puzzle.pieceCount,
  categoryKeys: [
    ...(puzzle.category ? [puzzle.category as string] : []),
    ...(puzzle.tags ?? []),
  ],
});

// Insights read query (thin adapter): build the member's taste signals from the catalog facets of
// puzzles they own/completed, gather a bounded pool of approved catalog definitions they do NOT own,
// apply the pure `recommendPuzzles` projection, then resolve each ranked key to a light view object
// the card can render. Read-only; no writes, no aggregates.
export const getRecommendations = query({
  args: {},
  handler: async (ctx) => {
    const memberId = await requireMember(ctx);
    const userId = memberId as unknown as Id<"users">;

    // The member's owned copies -> the puzzle definitions they already have (excluded from results).
    const copies = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const ownedPuzzleIds = new Set(copies.map((c) => c.puzzleId));

    // Completions reference the puzzle (general) or owned copy; pull their puzzle ids for signals.
    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const completedPuzzleIds = new Set(
      completions
        .map((c) => c.puzzleId)
        .filter((id): id is Id<"puzzles"> => id !== undefined),
    );

    // Resolve every distinct signal puzzle once for its facets.
    const signalPuzzleIds = [
      ...new Set<Id<"puzzles">>([...ownedPuzzleIds, ...completedPuzzleIds]),
    ];
    const signalPuzzles = await Promise.all(
      signalPuzzleIds.map((id) => ctx.db.get(id)),
    );
    const signalFacets = signalPuzzles
      .filter((p): p is Doc<"puzzles"> => p !== null)
      .map(facetsOf);

    // Bounded candidate pool: most-recent approved definitions the member does not already own. We
    // over-fetch then drop owned rows so the post-filter pool still fills the recommendation window.
    const approved = await ctx.db
      .query("puzzles")
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "approved"))
      .take(CANDIDATE_SCAN_LIMIT);
    const candidatePool = approved.filter((p) => !ownedPuzzleIds.has(p._id));

    // Recency rank from scan order (most-recent first); a deterministic tiebreak in the projection.
    const candidates: CandidatePuzzle[] = candidatePool.map((p, index) => ({
      key: p._id,
      ...facetsOf(p),
      recencyRank: index,
    }));

    const ranked = recommendPuzzles({
      signals: { facets: signalFacets },
      candidates,
      limit: RESULT_LIMIT,
    });

    // Resolve each ranked key to a light view object the UI can render (title/brand/pieces/thumb).
    const byId = new Map(candidatePool.map((p) => [p._id as string, p]));
    return Promise.all(
      ranked.map(async (rec) => {
        const puzzle = byId.get(rec.key);
        return {
          puzzleId: rec.key,
          score: rec.score,
          reason: rec.reason,
          title: puzzle?.title ?? "",
          brand: puzzle?.brand,
          pieceCount: puzzle?.pieceCount,
          thumbnail:
            puzzle?.image != null
              ? await ctx.storage.getUrl(puzzle.image)
              : undefined,
        };
      }),
    );
  },
});

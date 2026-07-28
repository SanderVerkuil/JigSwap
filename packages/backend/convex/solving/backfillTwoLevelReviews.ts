import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

// One-off, idempotent migration to the two-level review model. Legacy sources — completion
// rating/review columns and puzzleComments ratings — are folded into `puzzleReviews` (per
// member+puzzle) and `copyReviews` (per member+copy), then cleaned up: completion rating/review
// unset, comment ratings unset, definition-scoped comments deleted (copy-scoped comments are kept
// as plain comments). Pairs that already have a review row are skipped so live-app upserts win.
// Run manually (npx convex run solving/backfillTwoLevelReviews:backfillTwoLevelReviews); single
// pass over small pre-release tables, like solving/backfillCompletionPuzzleId.

type Candidate = { ts: number; rating?: number; text?: string };

// Match the domain's text normalisation (upsert-puzzle-review.ts): trim, and treat empty/
// whitespace-only text as absent — untrimmed migrated text would defeat the dialogs' dirty
// tracking, which compares trimmed form input against the stored value.
const normalizeText = (text?: string): string | undefined => {
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

// Group `candidate` under `key`, tracking the pair's identifying ids alongside.
function addCandidate<K>(
  map: Map<string, { ids: K; candidates: Candidate[] }>,
  key: string,
  ids: K,
  candidate: Candidate,
) {
  const entry = map.get(key);
  if (entry) {
    entry.candidates.push(candidate);
  } else {
    map.set(key, { ids, candidates: [candidate] });
  }
}

export const backfillTwoLevelReviews = internalMutation({
  args: {},
  handler: async (ctx) => {
    const completions = await ctx.db.query("completions").collect();
    const comments = await ctx.db.query("puzzleComments").collect();

    // --- Gather puzzle-level candidates per (member, puzzle) ---
    const puzzlePairs = new Map<
      string,
      {
        ids: { userId: Id<"users">; puzzleId: Id<"puzzles"> };
        candidates: Candidate[];
      }
    >();
    for (const row of completions) {
      if (row.rating == null || !row.puzzleId) continue;
      addCandidate(
        puzzlePairs,
        `${row.userId}|${row.puzzleId}`,
        { userId: row.userId, puzzleId: row.puzzleId },
        {
          ts: row.updatedAt,
          rating: row.rating,
          text: normalizeText(row.review),
        },
      );
    }
    for (const row of comments) {
      if (row.copyId !== undefined) continue; // definition-scoped only
      const text = normalizeText(row.text);
      // A comment with neither a rating nor (normalised) text carries nothing — no candidate,
      // so a pair with only such comments gets no review row. (Cleanup still deletes it below.)
      if (row.rating == null && text === undefined) continue;
      addCandidate(
        puzzlePairs,
        `${row.authorId}|${row.puzzleId}`,
        { userId: row.authorId, puzzleId: row.puzzleId },
        { ts: row._creationTime, rating: row.rating, text },
      );
    }

    // --- Gather copy-level candidates per (member, copy) — rated candidates only ---
    const copyPairs = new Map<
      string,
      {
        ids: { userId: Id<"users">; copyId: Id<"ownedPuzzles"> };
        candidates: Candidate[];
      }
    >();
    for (const row of completions) {
      if (row.rating == null || !row.ownedPuzzleId) continue;
      addCandidate(
        copyPairs,
        `${row.userId}|${row.ownedPuzzleId}`,
        { userId: row.userId, copyId: row.ownedPuzzleId },
        { ts: row.updatedAt, rating: row.rating },
      );
    }
    for (const row of comments) {
      if (row.copyId === undefined || row.rating == null) continue;
      addCandidate(
        copyPairs,
        `${row.authorId}|${row.copyId}`,
        { userId: row.authorId, copyId: row.copyId },
        { ts: row._creationTime, rating: row.rating },
      );
    }

    // --- Insert puzzleReviews: rating and text resolve INDEPENDENTLY to the newest holder ---
    let puzzleReviewsCreated = 0;
    for (const { ids, candidates } of puzzlePairs.values()) {
      const existing = await ctx.db
        .query("puzzleReviews")
        .withIndex("by_user_puzzle", (q) =>
          q.eq("userId", ids.userId).eq("puzzleId", ids.puzzleId),
        )
        .unique();
      if (existing) continue; // live-app upserts win

      const newestFirst = [...candidates].sort((a, b) => b.ts - a.ts);
      const rating = newestFirst.find((c) => c.rating != null)?.rating;
      const text = newestFirst.find((c) => c.text != null)?.text;
      const ts = newestFirst[0].ts;
      await ctx.db.insert("puzzleReviews", {
        userId: ids.userId,
        puzzleId: ids.puzzleId,
        ...(rating !== undefined ? { rating } : {}),
        ...(text !== undefined ? { text } : {}),
        createdAt: ts,
        updatedAt: ts,
      });
      puzzleReviewsCreated += 1;
    }

    // --- Insert copyReviews: the newest rated candidate wins outright ---
    let copyReviewsCreated = 0;
    for (const { ids, candidates } of copyPairs.values()) {
      const copy = await ctx.db.get(ids.copyId);
      if (!copy) continue; // copy deleted — nothing to review

      const existing = await ctx.db
        .query("copyReviews")
        .withIndex("by_user_copy", (q) =>
          q.eq("userId", ids.userId).eq("copyId", ids.copyId),
        )
        .unique();
      if (existing) continue; // live-app upserts win

      const newest = [...candidates].sort((a, b) => b.ts - a.ts)[0];
      await ctx.db.insert("copyReviews", {
        userId: ids.userId,
        copyId: ids.copyId,
        rating: newest.rating!,
        createdAt: newest.ts,
        updatedAt: newest.ts,
      });
      copyReviewsCreated += 1;
    }

    // --- Cleanup: strip legacy columns and drop definition-scoped comments ---
    let completionsCleaned = 0;
    for (const row of completions) {
      if (row.rating == null && row.review == null) continue;
      await ctx.db.patch(row._id, { rating: undefined, review: undefined });
      completionsCleaned += 1;
    }

    let commentsCleaned = 0;
    let definitionCommentsDeleted = 0;
    for (const row of comments) {
      if (row.copyId === undefined) {
        await ctx.db.delete(row._id);
        definitionCommentsDeleted += 1;
      } else if (row.rating != null) {
        await ctx.db.patch(row._id, { rating: undefined });
        commentsCleaned += 1;
      }
    }

    return {
      puzzleReviewsCreated,
      copyReviewsCreated,
      completionsCleaned,
      commentsCleaned,
      definitionCommentsDeleted,
    };
  },
});

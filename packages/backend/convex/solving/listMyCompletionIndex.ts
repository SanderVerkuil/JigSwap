import type { MyCompletionIndexRow } from "@jigswap/contracts";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { COMPLETION_INDEX_CAP } from "./completionLogLimits";

// Read side for the completion log: one lean row per solve of the acting member, with what its stats,
// its In progress section, its order and its year headings need, and nothing else (no notes, no
// photos). The log orders by solve date, year-only solves after dated ones and undated ones last,
// which no index can serve, so it works that out in the browser and asks getMyCompletionsByIds for
// the rows on screen. At most COMPLETION_INDEX_CAP, newest logged first.
//
// `pieceCount` is what the solve counts for: the piece count the copy had when it was solved (the
// durable snapshot), or for a legacy row without one its puzzle's or its copy's puzzle's.
export const listMyCompletionIndex = query({
  args: {},
  handler: async (ctx): Promise<MyCompletionIndexRow[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const rows = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", me))
      .order("desc")
      .take(COMPLETION_INDEX_CAP);

    const puzzles = new Map<Id<"puzzles">, Promise<Doc<"puzzles"> | null>>();
    const pieceCountOf = async (
      puzzleId: Id<"puzzles">,
    ): Promise<number | undefined> => {
      const known = puzzles.get(puzzleId);
      const pending = known ?? ctx.db.get(puzzleId);
      if (!known) puzzles.set(puzzleId, pending);
      return (await pending)?.pieceCount;
    };
    const legacyPieceCount = async (row: Doc<"completions">) => {
      if (row.puzzleId) return pieceCountOf(row.puzzleId);
      if (!row.ownedPuzzleId) return undefined;
      const copy = await ctx.db.get(row.ownedPuzzleId);
      return copy ? pieceCountOf(copy.puzzleId) : undefined;
    };

    return Promise.all(
      rows.map(async (row): Promise<MyCompletionIndexRow> => {
        const pieceCount = row.isCompleted
          ? (row.copySnapshot?.pieceCount ?? (await legacyPieceCount(row)))
          : undefined;
        return {
          _id: row._id,
          isCompleted: row.isCompleted,
          startDate: row.startDate,
          ...(row.endDate !== undefined && { endDate: row.endDate }),
          ...(row.datePrecision !== undefined && {
            datePrecision: row.datePrecision,
          }),
          ...(pieceCount !== undefined && { pieceCount }),
        };
      }),
    );
  },
});

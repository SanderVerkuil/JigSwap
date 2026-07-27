import type { InProgressSolveView } from "@jigswap/contracts";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// The acting member's in-progress solves, newest-started first. Uses the narrow
// (userId, isCompleted) index so the read set is only the in-progress slice — the dashboard
// subscription must not re-run when an old finished solve is edited. Display data resolves
// copySnapshot -> catalog puzzle so rows survive copy deletion. Rows lacking an aggregateId
// (legacy) are dropped: the UI cannot finish them.
export const listMyInProgress = query({
  args: {},
  handler: async (ctx): Promise<InProgressSolveView[]> => {
    const memberId = await requireMember(ctx);
    const rows = await ctx.db
      .query("completions")
      .withIndex("by_user_completed", (q) =>
        q
          .eq("userId", memberId as unknown as Id<"users">)
          .eq("isCompleted", false),
      )
      .collect();

    const withIds = rows.filter((row) => row.aggregateId !== undefined);
    withIds.sort((a, b) => b.startDate - a.startDate);

    return Promise.all(
      withIds.map(async (row) => {
        let title = row.copySnapshot?.title;
        let pieceCount = row.copySnapshot?.pieceCount;
        let thumbnailUrl: string | undefined;
        const puzzle = row.puzzleId ? await ctx.db.get(row.puzzleId) : null;
        if (puzzle) {
          title ??= puzzle.title;
          pieceCount ??= puzzle.pieceCount;
          if (puzzle.image) {
            thumbnailUrl =
              (await ctx.storage.getUrl(puzzle.image)) ?? undefined;
          }
        }
        return {
          completionId: row.aggregateId as string,
          title,
          pieceCount,
          startDate: row.startDate,
          copyId: row.copySnapshot?.copyId,
          thumbnailUrl,
        };
      }),
    );
  },
});

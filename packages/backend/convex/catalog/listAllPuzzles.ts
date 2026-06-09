import type { PuzzleSummaryView } from "@jigswap/contracts";
import { type PaginationResult, paginationOptsValidator } from "convex/server";
import { query } from "../_generated/server";
import { toPuzzleSummaryView } from "./mappers";

// Catalog read: the public, browsable puzzle list (paginated). Pending/rejected submissions must
// not leak, so we filter to approved — identical to legacy puzzles.listAllpuzzles. Each page row is
// mapped to a typed summary DTO (box-art URL resolved) rather than the raw Convex row.
export const listAllPuzzles = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    args,
  ): Promise<PaginationResult<PuzzleSummaryView>> => {
    const puzzles = await ctx.db
      .query("puzzles")
      .filter((q) => q.eq(q.field("status"), "approved"))
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      puzzles.page.map(async (puzzle) =>
        toPuzzleSummaryView(
          puzzle,
          puzzle.image ? await ctx.storage.getUrl(puzzle.image) : null,
        ),
      ),
    );

    return { ...puzzles, page };
  },
});

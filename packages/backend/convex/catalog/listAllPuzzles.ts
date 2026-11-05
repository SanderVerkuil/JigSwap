import type { PuzzleSummaryView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { query } from "../_generated/server";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import { clampPaginationOpts } from "../lib/pageSize";
import { toPuzzleSummaryView } from "./mappers";

// A page holds 1 to MAX_PAGE_SIZE puzzles whatever the client asks for.
const MAX_PAGE_SIZE = 50;

// Catalog read: the public, browsable puzzle list (paginated). Pending/rejected submissions must
// not leak, so only approved rows are read (by_status index, oldest first as legacy
// puzzles.listAllpuzzles). Each page row is mapped to a typed summary DTO (box-art URL resolved)
// rather than the raw Convex row.
export const listAllPuzzles = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args): Promise<PaginationResult<PuzzleSummaryView>> => {
    const puzzles = await ctx.db
      .query("puzzles")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .paginate(clampPaginationOpts(args.paginationOpts, MAX_PAGE_SIZE));

    const page = await Promise.all(
      puzzles.page.map(async (puzzle) =>
        toPuzzleSummaryView(
          puzzle,
          puzzle.image ? await boxArtImage(ctx, puzzle.image) : null,
        ),
      ),
    );

    return { ...puzzles, page };
  },
});

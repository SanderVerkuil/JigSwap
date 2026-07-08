import type { AdminPuzzleDefinitionRowView } from "@jigswap/contracts";
import { type PaginationResult, paginationOptsValidator } from "convex/server";
import { ConvexError } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Admin read model: EVERY catalog definition regardless of status, newest first, paginated.
// The public lists filter to approved; this console must also show pending/rejected/disabled.
// Each row joins the admin metadata the /admin/puzzles table renders: submitter display name,
// resolved thumbnail URL, and the distinct-owner count (ownedPuzzles.by_puzzle → dedupe
// ownerId, the getPuzzleDefinitionView pattern). Admin-only, gated exactly like
// getModerationActivity.
export const listPuzzleDefinitions = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (
    ctx,
    args,
  ): Promise<PaginationResult<AdminPuzzleDefinitionRowView>> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const puzzles = await ctx.db
      .query("puzzles")
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      puzzles.page.map(
        async (puzzle): Promise<AdminPuzzleDefinitionRowView> => {
          const owned = await ctx.db
            .query("ownedPuzzles")
            .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzle._id))
            .collect();
          const distinctOwners = new Set(
            owned.map((copy) => copy.ownerId as unknown as string),
          );
          const submitter = await ctx.db.get(puzzle.submittedBy);
          return {
            _id: puzzle._id as string,
            aggregateId: puzzle.aggregateId,
            title: puzzle.title,
            brand: puzzle.brand,
            pieceCount: puzzle.pieceCount,
            status: puzzle.status,
            createdAt: puzzle.createdAt,
            submitterName: submitter?.name ?? null,
            image: puzzle.image ? await ctx.storage.getUrl(puzzle.image) : null,
            ownerCount: distinctOwners.size,
          };
        },
      ),
    );

    return { ...puzzles, page };
  },
});

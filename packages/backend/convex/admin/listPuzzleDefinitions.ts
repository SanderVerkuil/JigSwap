import type { AdminPuzzleDefinitionRowView } from "@jigswap/contracts";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { adminMemberLabelOf } from "../identity/memberDisplayName";
import { requireMember } from "../identity/requireMember";
import { boxArtUrl } from "../lib/imageModeration/boxArtUrl";
import {
  clampPaginationOpts,
  clampUnpinnedPaginationOpts,
} from "../lib/pageSize";
import { definitionTotalsOf } from "../library/definitionStats";

// Admin-only, but the page size is still the client's request: each row joins its submitter, its
// box art and its owner count, so a page holds at most this many (the table asks for 25).
const MAX_PAGE_SIZE = 50;
// Copies of one definition read for its owner count until its totals have one. Past this it is a
// lower bound, for at most a week: the weekly reconcile writes it for every definition.
const OWNER_SCAN_CAP = 100;

// Admin read model: EVERY catalog definition regardless of status, newest first, paginated.
// The public lists filter to approved; this console must also show pending/rejected/disabled.
// Optional filters: `status` reads that status through puzzles.by_status (newest first); `search`
// uses the catalogue search index (by_searchable_text, relevance order) over every status, narrowed
// to `status` at the index when both are given.
// Each row joins the admin metadata the /admin/puzzles table renders: submitter display name,
// resolved thumbnail URL (plus whether its blob is gone), and the distinct-owner count from the
// definition's totals (library/definitionStats), one read however many copies it has, so a member
// adding copies by the thousand can't break the page used to find them. Admin-only, gated exactly
// like getModerationActivity.
export const listPuzzleDefinitions = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("disabled"),
      ),
    ),
    search: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<PaginationResult<AdminPuzzleDefinitionRowView>> => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const { status } = args;
    const term = args.search?.trim().toLowerCase() ?? "";
    const paginationOpts = clampPaginationOpts(
      args.paginationOpts,
      MAX_PAGE_SIZE,
    );
    const puzzles =
      term.length > 0
        ? await ctx.db
            .query("puzzles")
            .withSearchIndex("by_searchable_text", (q) => {
              const matching = q.search("searchableText", term);
              return status ? matching.eq("status", status) : matching;
            })
            .paginate(
              clampUnpinnedPaginationOpts(args.paginationOpts, MAX_PAGE_SIZE),
            )
        : status
          ? await ctx.db
              .query("puzzles")
              .withIndex("by_status", (q) => q.eq("status", status))
              .order("desc")
              .paginate(paginationOpts)
          : await ctx.db
              .query("puzzles")
              .order("desc")
              .paginate(paginationOpts);

    const page = await Promise.all(
      puzzles.page.map(
        async (puzzle): Promise<AdminPuzzleDefinitionRowView> => {
          const ownerCount =
            (await definitionTotalsOf(ctx, puzzle._id))?.ownerCount ??
            new Set(
              (
                await ctx.db
                  .query("ownedPuzzles")
                  .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzle._id))
                  .take(OWNER_SCAN_CAP)
              ).map((copy) => copy.ownerId),
            ).size;
          const submitter = await ctx.db.get(puzzle.submittedBy);
          return {
            _id: puzzle._id as string,
            aggregateId: puzzle.aggregateId,
            title: puzzle.title,
            brand: puzzle.brand,
            pieceCount: puzzle.pieceCount,
            status: puzzle.status,
            createdAt: puzzle.createdAt,
            submitterName: submitter ? adminMemberLabelOf(submitter) : null,
            image: puzzle.image ? await boxArtUrl(ctx, puzzle.image) : null,
            // SEC-01: the box art was destroyed (its blob is gone) and must be uploaded again.
            imageMissing:
              puzzle.image !== undefined &&
              (await ctx.db.system.get(puzzle.image)) === null,
            ownerCount,
          };
        },
      ),
    );

    return { ...puzzles, page };
  },
});

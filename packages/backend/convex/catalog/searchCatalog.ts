import type { PuzzleSummaryView } from "@jigswap/contracts";
import { puzzleSearchTerm } from "@jigswap/domain";
import {
  paginationOptsValidator,
  type FilterBuilder,
  type NamedTableInfo,
  type PaginationResult,
} from "convex/server";
import { v } from "convex/values";
import type { DataModel } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import { clampUnpinnedPaginationOpts, paginateBounded } from "../lib/pageSize";
import { toPuzzleSummaryView } from "./mappers";

// A page holds 1 to MAX_PAGE_SIZE puzzles whatever the client asks for.
const MAX_PAGE_SIZE = 50;

// Catalog read for the member catalogue (/puzzles) and the add-copy picker: the approved
// catalogue, paginated, narrowed server-side by the search index when a term is given (so matches
// beyond the loaded page are found). Approved-only: at the search index for a term, at the
// by_status index for the plain browse.
//
// Optional facets narrow both branches the same way. Brand, piece range, difficulty and category
// are part of the scan filter, so pages stay full. Tags (any-of) can't be expressed as a filter on
// an array field, so they narrow each page after the read; a page can come back short, never wrong.
// `category` is a string because it arrives from a URL search param: a malformed id gives an empty,
// finished page instead of failing the query.
export const searchCatalog = query({
  args: {
    paginationOpts: paginationOptsValidator,
    searchTerm: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceMin: v.optional(v.number()),
    pieceMax: v.optional(v.number()),
    difficulty: v.optional(
      v.union(
        v.literal("easy"),
        v.literal("medium"),
        v.literal("hard"),
        v.literal("expert"),
      ),
    ),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<PaginationResult<PuzzleSummaryView>> => {
    await requireMember(ctx);
    const term = args.searchTerm?.toLowerCase().trim() ?? "";
    const category =
      args.category === undefined
        ? undefined
        : ctx.db.normalizeId("adminCategories", args.category);
    if (category === null) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const facets = (q: FilterBuilder<NamedTableInfo<DataModel, "puzzles">>) =>
      q.and(
        q.eq(q.field("status"), "approved"),
        ...(args.brand === undefined
          ? []
          : [q.eq(q.field("brand"), args.brand)]),
        ...(args.pieceMin === undefined
          ? []
          : [q.gte(q.field("pieceCount"), args.pieceMin)]),
        ...(args.pieceMax === undefined
          ? []
          : [q.lte(q.field("pieceCount"), args.pieceMax)]),
        ...(args.difficulty === undefined
          ? []
          : [q.eq(q.field("difficulty"), args.difficulty)]),
        ...(category === undefined
          ? []
          : [q.eq(q.field("category"), category)]),
      );

    const result =
      term.length > 0
        ? await ctx.db
            .query("puzzles")
            .withSearchIndex("by_searchable_text", (q) =>
              q
                .search("searchableText", puzzleSearchTerm(term))
                .eq("status", "approved"),
            )
            .filter(facets)
            .paginate(
              clampUnpinnedPaginationOpts(args.paginationOpts, MAX_PAGE_SIZE),
            )
        : await paginateBounded(
            ctx.db
              .query("puzzles")
              .withIndex("by_status", (q) => q.eq("status", "approved"))
              .filter(facets),
            args.paginationOpts,
            MAX_PAGE_SIZE,
          );

    const tags = args.tags ?? [];
    const rows =
      tags.length === 0
        ? result.page
        : result.page.filter((puzzle) =>
            tags.some((tag) => puzzle.tags?.includes(tag)),
          );

    const page = await Promise.all(
      rows.map(async (puzzle) =>
        toPuzzleSummaryView(
          puzzle,
          puzzle.image ? await boxArtImage(ctx, puzzle.image) : null,
        ),
      ),
    );

    return { ...result, page };
  },
});

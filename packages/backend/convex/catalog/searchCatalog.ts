import type { PuzzleSummaryView } from "@jigswap/contracts";
import { puzzleSearchTerm } from "@jigswap/domain";
import {
  paginationOptsValidator,
  type FilterBuilder,
  type NamedTableInfo,
  type PaginationResult,
} from "convex/server";
import { v } from "convex/values";
import type { DataModel, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import { clampUnpinnedPaginationOpts, paginateBounded } from "../lib/pageSize";
import {
  publicAvailabilityFromByType,
  publicAvailabilityOf,
} from "../library/definitionAggregates";
import { definitionTotalsOf } from "../library/definitionStats";
import { blockedEitherWaySet } from "../social/blocks";
import { toPuzzleSummaryView } from "./mappers";

// A page holds 1 to MAX_PAGE_SIZE puzzles whatever the client asks for.
const MAX_PAGE_SIZE = 50;
// Copies of one definition looked through for blocked owners' offers, so a definition with a flood
// of copies can't use up a blocking viewer's read limit. Past it the chip can overcount.
const MAX_COPIES_CHECKED_FOR_BLOCKS = 200;

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
//
// Each row carries `availableCount`, for the card's link to Browse: the definition's stored public
// offers (one definitionStats row per card) minus the viewer's own and those of members blocked
// either way, which Browse never lists. Only a viewer with blocks pays a read of the definition's
// copies per card. A definition whose stats don't exist yet has no count: this paged list never
// computes them live.
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
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
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

    const blockedOwners = await blockedEitherWaySet(ctx, me);
    const visibilityCache = new Map<string, "public" | "private">();
    const blockedOwnersCopies = async (puzzleId: Id<"puzzles">) => {
      if (blockedOwners.size === 0) return [];
      const copies = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId))
        .take(MAX_COPIES_CHECKED_FOR_BLOCKS);
      return copies.filter((copy) => blockedOwners.has(copy.ownerId));
    };
    const availableFromOthers = async (
      puzzleId: Id<"puzzles">,
    ): Promise<number> => {
      const totals = await definitionTotalsOf(ctx, puzzleId);
      if (!totals) return 0;
      const { total } = publicAvailabilityFromByType(totals.publicAvailable);
      if (total === 0) return 0;
      const mine = await ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner_puzzle", (q) =>
          q.eq("ownerId", me).eq("puzzleId", puzzleId),
        )
        .collect();
      const hidden = [...mine, ...(await blockedOwnersCopies(puzzleId))];
      return (
        total - (await publicAvailabilityOf(ctx, hidden, visibilityCache)).total
      );
    };

    const page = await Promise.all(
      rows.map(async (puzzle) => {
        const availableCount = await availableFromOthers(puzzle._id);
        return {
          ...toPuzzleSummaryView(
            puzzle,
            puzzle.image ? await boxArtImage(ctx, puzzle.image) : null,
          ),
          ...(availableCount > 0 ? { availableCount } : {}),
        };
      }),
    );

    return { ...result, page };
  },
});

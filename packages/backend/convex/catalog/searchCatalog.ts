import type { PuzzleSummaryView } from "@jigswap/contracts";
import { puzzleSearchTerm } from "@jigswap/domain";
import {
  paginationOptsValidator,
  type FilterBuilder,
  type NamedTableInfo,
  type PaginationResult,
} from "convex/server";
import { v } from "convex/values";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import {
  clampUnpinnedPaginationOpts,
  paginateBounded,
  PINNED_PAGE_READ_FACTOR,
} from "../lib/pageSize";
import {
  publicAvailabilityFromByType,
  publicAvailabilityOf,
} from "../library/definitionAggregates";
import { definitionTotalsOf } from "../library/definitionStats";
import { blockedEitherWaySet } from "../social/blocks";
import { toPuzzleSummaryView } from "./mappers";

// A page holds 1 to MAX_PAGE_SIZE puzzles whatever the client asks for.
const MAX_PAGE_SIZE = 50;
// The most rows one call of the plain browse reads to fill a page, matches or not: as far as a page a
// hook has pinned may read, so a page cut here can be split without being cut again.
export const SEARCH_CATALOG_ROWS_READ = MAX_PAGE_SIZE * PINNED_PAGE_READ_FACTOR;
// What one card's chip looks through for offers to leave out of the definition's stored count: the
// viewer's own copies of it, and those of this many members blocked either way, at most this many
// copies across them. Anyone can block a viewer and pile long copies onto a definition, so these cap
// what a page can cost; the chip can overcount past them. The viewer's own blocks are looked at first.
const MAX_BLOCKED_OWNERS_CHECKED = 8;
const MAX_COPIES_CHECKED = 20;

// Catalog read for the member catalogue (/puzzles) and the add-copy picker: the approved
// catalogue, paginated, narrowed server-side by the search index when a term is given (so matches
// beyond the loaded page are found). Approved-only: at the search index for a term, at the
// by_status index for the plain browse.
//
// Optional facets narrow both branches the same way. Brand and piece range choose the index the plain
// browse reads, so a filter that matches little reads little (with a piece range and no brand it reads
// smallest first). Difficulty and category filter as the read goes: it stops at
// SEARCH_CATALOG_ROWS_READ rows, so what a call costs doesn't grow with the catalogue, and a page that
// didn't fill comes back short, even empty, with `isDone` false and the cursor where it stopped. The
// web keeps asking and says "so far" until it is done. Tags (any-of) can't be expressed as a filter on
// an array field, so they narrow each page after the read; a page can come back short, never wrong.
// `category` is a string because it arrives from a URL search param: a malformed id gives an empty,
// finished page instead of failing the query.
//
// Each row carries `availableCount`, for the card's link to Browse: the definition's stored public
// offers (one definitionStats row per card) minus the viewer's own and those of members blocked
// either way, which Browse never lists. Those come from the owners' own rows, so other members' copies
// of the definition are never read. A definition whose stats don't exist yet has no count: this paged
// list never computes them live.
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
    const { brand, pieceMin, pieceMax } = args;
    if (
      category === null ||
      (pieceMin !== undefined && pieceMax !== undefined && pieceMin > pieceMax)
    ) {
      return { page: [], isDone: true, continueCursor: "" };
    }

    const facets = (q: FilterBuilder<NamedTableInfo<DataModel, "puzzles">>) =>
      q.and(
        q.eq(q.field("status"), "approved"),
        ...(brand === undefined ? [] : [q.eq(q.field("brand"), brand)]),
        ...(pieceMin === undefined
          ? []
          : [q.gte(q.field("pieceCount"), pieceMin)]),
        ...(pieceMax === undefined
          ? []
          : [q.lte(q.field("pieceCount"), pieceMax)]),
        ...(args.difficulty === undefined
          ? []
          : [q.eq(q.field("difficulty"), args.difficulty)]),
        ...(category === undefined
          ? []
          : [q.eq(q.field("category"), category)]),
      );

    // The approved rows a plain browse walks: one brand's, one piece range's, or all of them.
    const approvedRows = () => {
      const puzzles = ctx.db.query("puzzles");
      if (brand !== undefined) {
        return puzzles.withIndex("by_status_brand", (q) =>
          q.eq("status", "approved").eq("brand", brand),
        );
      }
      if (pieceMin !== undefined || pieceMax !== undefined) {
        return puzzles.withIndex("by_status_pieces", (q) => {
          const approved = q.eq("status", "approved");
          if (pieceMin === undefined) {
            return approved.lte("pieceCount", pieceMax!);
          }
          const from = approved.gte("pieceCount", pieceMin);
          return pieceMax === undefined
            ? from
            : from.lte("pieceCount", pieceMax);
        });
      }
      return puzzles.withIndex("by_status", (q) => q.eq("status", "approved"));
    };

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
            approvedRows().filter(facets),
            {
              ...args.paginationOpts,
              maximumRowsRead: SEARCH_CATALOG_ROWS_READ,
            },
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
    const ownerCopiesOf = (
      ownerId: Id<"users">,
      puzzleId: Id<"puzzles">,
      count: number,
    ) =>
      ctx.db
        .query("ownedPuzzles")
        .withIndex("by_owner_puzzle", (q) =>
          q.eq("ownerId", ownerId).eq("puzzleId", puzzleId),
        )
        .take(count);
    const blockedOwnersChecked = [...blockedOwners].slice(
      0,
      MAX_BLOCKED_OWNERS_CHECKED,
    );
    const blockedOwnersCopies = async (puzzleId: Id<"puzzles">) => {
      const copies: Doc<"ownedPuzzles">[] = [];
      for (const ownerId of blockedOwnersChecked) {
        if (copies.length >= MAX_COPIES_CHECKED) break;
        copies.push(
          ...(await ownerCopiesOf(
            ownerId,
            puzzleId,
            MAX_COPIES_CHECKED - copies.length,
          )),
        );
      }
      return copies;
    };
    const availableFromOthers = async (
      puzzleId: Id<"puzzles">,
    ): Promise<number> => {
      const totals = await definitionTotalsOf(ctx, puzzleId);
      if (!totals) return 0;
      const { total } = publicAvailabilityFromByType(totals.publicAvailable);
      if (total === 0) return 0;
      const mine = await ownerCopiesOf(me, puzzleId, MAX_COPIES_CHECKED);
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

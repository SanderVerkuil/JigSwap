import type { BrowseOwnedCopiesView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toOwnedCopyView } from "./mappers";

// Library read: browse OTHER members' available owned copies with filters. Auth gating, the
// availability prefilter, every puzzle-based filter (category/pieces/difficulty/search), the
// newest-first ordering, the owner join, and offset/limit paging are preserved from legacy
// puzzles.browseOwnedPuzzles; the result maps to a typed paginated DTO.
export const browseOwnedPuzzles = query({
  args: {
    category: v.optional(v.id("adminCategories")),
    minPieceCount: v.optional(v.number()),
    maxPieceCount: v.optional(v.number()),
    difficulty: v.optional(
      v.union(
        v.literal("easy"),
        v.literal("medium"),
        v.literal("hard"),
        v.literal("expert"),
      ),
    ),
    condition: v.optional(
      v.union(
        v.literal("new_sealed"),
        v.literal("like_new"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
      ),
    ),
    searchTerm: v.optional(v.string()),
    includeOwnPuzzles: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BrowseOwnedCopiesView> => {
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    // Resolve the acting member (auth-gated, identical to legacy). The domain MemberId is the
    // user's Convex _id.
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    let ownedPuzzles = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
      .filter((f) =>
        f.or(
          f.eq(f.field("availability.forTrade"), true),
          f.eq(f.field("availability.forSale"), true),
          f.eq(f.field("availability.forLend"), true),
        ),
      )
      .collect();

    if (args.condition) {
      ownedPuzzles = ownedPuzzles.filter((i) => i.condition === args.condition);
    }

    const withPuzzles = await Promise.all(
      ownedPuzzles.map(async (copy) => ({
        copy,
        puzzle: await ctx.db.get(copy.puzzleId),
      })),
    );

    let filtered = withPuzzles;

    if (args.category) {
      filtered = filtered.filter(
        (i) => i.puzzle?.category === args.category && i.puzzle?.category !== undefined,
      );
    }
    if (args.minPieceCount !== undefined) {
      filtered = filtered.filter(
        (i) => i.puzzle && i.puzzle.pieceCount >= args.minPieceCount!,
      );
    }
    if (args.maxPieceCount !== undefined) {
      filtered = filtered.filter(
        (i) => i.puzzle && i.puzzle.pieceCount <= args.maxPieceCount!,
      );
    }
    if (args.difficulty) {
      filtered = filtered.filter((i) => i.puzzle?.difficulty === args.difficulty);
    }
    if (args.searchTerm) {
      const searchTerm = args.searchTerm.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.puzzle &&
          (i.puzzle.title.toLowerCase().includes(searchTerm) ||
            (i.puzzle.description &&
              i.puzzle.description.toLowerCase().includes(searchTerm)) ||
            (i.puzzle.brand &&
              i.puzzle.brand.toLowerCase().includes(searchTerm)) ||
            (i.puzzle.tags &&
              i.puzzle.tags.some((tag) => tag.toLowerCase().includes(searchTerm)))),
      );
    }

    filtered.sort((a, b) => b.copy.createdAt - a.copy.createdAt);

    const page = await Promise.all(
      filtered.slice(offset, offset + limit).map(async ({ copy, puzzle }) =>
        toOwnedCopyView(copy, puzzle, {
          owner: await ctx.db.get(copy.ownerId),
        }),
      ),
    );

    return {
      ownedPuzzles: page,
      total: filtered.length,
      hasMore: offset + limit < filtered.length,
    };
  },
});

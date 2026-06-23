import type { BrowseOwnedCopiesView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { profileVisibilityOf } from "../social/privacy";
import { collectCircleSharedCopies } from "./circleSharedCopies";
import { toOwnedCopyView } from "./mappers";
import { resolveCopyCoverUrl } from "./resolveCoverUrl";

// A copy is "open" iff at least one exchange-availability flag is set. Rule 1 of Browse
// visibility: only open copies are ever shown, including circle-shared ones.
const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

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

    // Availability-sourced candidate set: every OPEN copy (rule 1). Convex can't `neq` on an
    // index, so we collect the availability-filtered set and exclude the viewer's own copies in
    // memory (unless includeOwnPuzzles). Browse shows OTHER members' available copies.
    // Perf: bound the worst-case scan with `.take(500)` instead of an unbounded `.collect()`.
    // CAVEAT: this is a read-cap, not a true index — at large catalogue scale this set should be
    // sourced from a dedicated availability index + cursor paging rather than an in-memory filter.
    const availableNotOwn = (
      await ctx.db
        .query("ownedPuzzles")
        .filter((f) =>
          f.or(
            f.eq(f.field("availability.forTrade"), true),
            f.eq(f.field("availability.forSale"), true),
            f.eq(f.field("availability.forLend"), true),
          ),
        )
        .take(500)
    ).filter((c) => args.includeOwnPuzzles || c.ownerId !== memberId);

    // Circle-shared copies the viewer may see (cross-context). Rule 1 applies to these too: a
    // copy must be OPEN to appear, even when reached via a circle. Build the set of circle-shared
    // copy ids for the membership check below, and keep the (open) rows so the union also adds any
    // open circle copy the availability collect missed (e.g. a viewer's own copy is dropped above
    // but a fellow member's open circle copy that wasn't in the prefilter is added here).
    const circleShared = (
      await collectCircleSharedCopies(ctx, memberId)
    ).filter(isOpen);
    const circleSharedIds = new Set(
      circleShared.map((c) => c._id as unknown as string),
    );

    // Resolve each distinct owner's profile visibility ONCE (cache by ownerId), so we never issue
    // N profile queries for N copies by the same owner.
    const visibilityCache = new Map<string, "public" | "private">();
    const ownerIsPublic = async (ownerId: Id<"users">): Promise<boolean> => {
      const key = ownerId as unknown as string;
      let cached = visibilityCache.get(key);
      if (cached === undefined) {
        cached = await profileVisibilityOf(ctx, ownerId);
        visibilityCache.set(key, cached);
      }
      return cached === "public";
    };

    // Rule 2 (reachability): a copy is shown when its owner is PUBLIC, or the copy is circle-shared
    // with the viewer. Private, non-circle owners' copies are excluded entirely (no row over the
    // wire). Apply to the availability-sourced set, then UNION any open circle-shared copy the
    // availability collect missed — de-duplicated by copy id.
    const shown: Doc<"ownedPuzzles">[] = [];
    const seen = new Set<string>();
    for (const copy of availableNotOwn) {
      const id = copy._id as unknown as string;
      if (seen.has(id)) continue;
      if (circleSharedIds.has(id) || (await ownerIsPublic(copy.ownerId))) {
        shown.push(copy);
        seen.add(id);
      }
    }
    for (const copy of circleShared) {
      const id = copy._id as unknown as string;
      if (seen.has(id)) continue;
      // Circle copies still respect includeOwnPuzzles: a viewer's own copy is excluded by default.
      if (!args.includeOwnPuzzles && copy.ownerId === memberId) continue;
      shown.push(copy);
      seen.add(id);
    }

    let ownedPuzzles = shown;

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
        (i) =>
          i.puzzle?.category === args.category &&
          i.puzzle?.category !== undefined,
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
      filtered = filtered.filter(
        (i) => i.puzzle?.difficulty === args.difficulty,
      );
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
              i.puzzle.tags.some((tag) =>
                tag.toLowerCase().includes(searchTerm),
              ))),
      );
    }

    filtered.sort((a, b) => b.copy.createdAt - a.copy.createdAt);

    const page = await Promise.all(
      filtered.slice(offset, offset + limit).map(async ({ copy, puzzle }) =>
        toOwnedCopyView(copy, puzzle, {
          owner: await ctx.db.get(copy.ownerId),
          coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
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

import { stream } from "convex-helpers/server/stream";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema from "./schema";

export type PuzzleSuggestion = {
  title: string;
  description?: string;
  brand?: string;
  tags?: string[];
};

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const url = await ctx.storage.generateUploadUrl();
    return url;
  },
});

// Get owned puzzles by owner
export const getOwnedPuzzlesByOwner = query({
  args: {
    ownerId: v.id("users"),
    includeUnavailable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let ownedPuzzles = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    if (!args.includeUnavailable) {
      ownedPuzzles = ownedPuzzles.filter(
        (i) =>
          i.availability.forTrade ||
          i.availability.forSale ||
          i.availability.forLend,
      );
    }

    // Get puzzle information for each owned puzzle
    const ownedPuzzlesWithPuzzles = await Promise.all(
      ownedPuzzles.map(async (ownedPuzzle) => {
        const puzzle = await ctx.db.get(ownedPuzzle.puzzleId);
        return {
          ...ownedPuzzle,
          puzzle,
        };
      }),
    );

    return ownedPuzzlesWithPuzzles.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listAllpuzzles = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Public catalog: pending/rejected submissions must not leak into the browsable list.
    const puzzles = await ctx.db
      .query("puzzles")
      .filter((q) => q.eq(q.field("status"), "approved"))
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      puzzles.page.map(async (puzzle) => ({
        ...puzzle,
        image: puzzle.image
          ? await ctx.storage.getUrl(puzzle.image)
          : undefined,
      })),
    );
    return {
      ...puzzles,
      page,
    };
  },
});

// Get a single puzzle by ID
export const getPuzzleById = query({
  args: {
    puzzleId: v.id("puzzles"),
  },
  handler: async (ctx, args) => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle) {
      return null;
    }
    return {
      ...puzzle,
      image: puzzle.image ? await ctx.storage.getUrl(puzzle.image) : undefined,
    };
  },
});

export const getAllBrands = query({
  args: {},
  handler: async (ctx) => {
    const brands = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_brand", (q) => q)
      .distinct(["brand"])
      .collect();
    return brands.map((brand) => brand.brand);
  },
});

export const getAllTags = query({
  args: {},
  handler: async (ctx) => {
    const tags = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_tags", (q) => q)
      .distinct(["tags"])
      .collect();
    return tags
      .map((tag) => tag.tags)
      .flat()
      .filter((tags) => tags !== undefined)
      .reduce((acc, tag) => {
        if (tag && !acc.includes(tag)) {
          acc.push(tag);
        }
        return acc;
      }, [] as string[]);
  },
});

// Get the most recently created puzzles (global catalogue)
export const getRecentPuzzles = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 8;
    // Public catalog: only show approved submissions in the "recent" rail.
    const puzzles = await ctx.db
      .query("puzzles")
      .order("desc")
      .filter((q) => q.eq(q.field("status"), "approved"))
      .take(limit);

    const puzzlesWithImages = await Promise.all(
      puzzles.map(async (puzzle) => ({
        ...puzzle,
        image: puzzle.image ? await ctx.storage.getUrl(puzzle.image) : undefined,
      })),
    );

    return puzzlesWithImages;
  },
});

// Browse available owned puzzles with filters
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
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    let ownedPuzzles = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((f) =>
        f.or(
          f.eq(f.field("availability.forTrade"), true),
          f.eq(f.field("availability.forSale"), true),
          f.eq(f.field("availability.forLend"), true),
        ),
      )
      .collect();

    // Apply filters
    if (args.condition) {
      ownedPuzzles = ownedPuzzles.filter((i) => i.condition === args.condition);
    }

    // Get puzzle information for filtering
    const ownedPuzzlesWithPuzzles = await Promise.all(
      ownedPuzzles.map(async (ownedPuzzle) => {
        const puzzle = await ctx.db.get(ownedPuzzle.puzzleId);
        return {
          ...ownedPuzzle,
          puzzle,
        };
      }),
    );

    // Apply puzzle-based filters
    let filteredInstances = ownedPuzzlesWithPuzzles;

    if (args.category) {
      filteredInstances = filteredInstances.filter(
        (i) =>
          i.puzzle?.category === args.category &&
          i.puzzle?.category !== undefined,
      );
    }

    if (args.minPieceCount !== undefined) {
      filteredInstances = filteredInstances.filter(
        (i) => i.puzzle && i.puzzle.pieceCount >= args.minPieceCount!,
      );
    }

    if (args.maxPieceCount !== undefined) {
      filteredInstances = filteredInstances.filter(
        (i) => i.puzzle && i.puzzle.pieceCount <= args.maxPieceCount!,
      );
    }

    if (args.difficulty) {
      filteredInstances = filteredInstances.filter(
        (i) => i.puzzle?.difficulty === args.difficulty,
      );
    }

    if (args.searchTerm) {
      const searchTerm = args.searchTerm.toLowerCase();
      filteredInstances = filteredInstances.filter(
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

    // Sort by creation date (newest first)
    filteredInstances.sort((a, b) => b.createdAt - a.createdAt);

    // Get owner information for each owned puzzle
    const ownedPuzzlesWithOwners = await Promise.all(
      filteredInstances
        .slice(offset, offset + limit)
        .map(async (ownedPuzzle) => {
          const owner = await ctx.db.get(ownedPuzzle.ownerId);
          return {
            ...ownedPuzzle,
            owner: owner
              ? {
                  _id: owner._id,
                  name: owner.name,
                  username: owner.username,
                  avatar: owner.avatar,
                }
              : null,
          };
        }),
    );

    return {
      ownedPuzzles: ownedPuzzlesWithOwners,
      total: filteredInstances.length,
      hasMore: offset + limit < filteredInstances.length,
    };
  },
});

// Get puzzle categories (for filters)
export const getPuzzleCategories = query({
  args: {},
  handler: async (ctx) => {
    // Get all active admin categories
    const adminCategories = await ctx.db
      .query("adminCategories")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("asc")
      .collect();

    return adminCategories;
  },
});

// Get puzzle suggestions for form auto-fill
export const getPuzzleSuggestions = query({
  args: {
    searchTerm: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const searchTerm = args.searchTerm.toLowerCase().trim();

    if (searchTerm.length < 1) {
      return [];
    }

    const puzzles = await ctx.db
      .query("puzzles")
      .withSearchIndex("by_searchable_text", (q) =>
        // Public catalog: form auto-fill only suggests approved definitions.
        q.search("searchableText", searchTerm).eq("status", "approved"),
      )
      .take(limit);

    const puzzlesWithImages = await Promise.all(
      puzzles.map(async (puzzle) => ({
        ...puzzle,
        image: puzzle.image
          ? await ctx.storage.getUrl(puzzle.image)
          : undefined,
      })),
    );

    return puzzlesWithImages;
  },
});

export const getOwnedPuzzleWithCollectionStatus = query({
  args: { ownedPuzzleId: v.id("ownedPuzzles") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) {
      return null;
    }

    const ownedPuzzle = await ctx.db.get(args.ownedPuzzleId);
    if (!ownedPuzzle) return null;

    // Get puzzle information
    const puzzle = await ctx.db.get(ownedPuzzle.puzzleId);
    if (!puzzle) return null;

    // Get owner information
    const owner = await ctx.db.get(ownedPuzzle.ownerId);

    // Get collection status for current user
    const collection = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    // Get completion history for current user (for this specific owned puzzle)
    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user_owned_puzzle", (q) =>
        q.eq("userId", user._id).eq("ownedPuzzleId", args.ownedPuzzleId),
      )
      .filter((q) => q.eq(q.field("isCompleted"), true))
      .order("desc")
      .collect();

    const images = await ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) =>
        q.eq("ownedPuzzleId", args.ownedPuzzleId),
      )
      .collect();

    return {
      ...ownedPuzzle,
      puzzle,
      images,
      owner: owner
        ? {
            _id: owner._id,
            name: owner.name,
            username: owner.username,
            avatar: owner.avatar,
          }
        : null,
      collectionStatus: collection
        ? {
            isInCollection: true,
            visibility: collection.visibility,
            personalNotes: collection.personalNotes,
          }
        : {
            isInCollection: false,
          },
      completionHistory: completions,
    };
  },
});

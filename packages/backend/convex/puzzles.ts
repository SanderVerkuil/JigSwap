import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Create a new puzzle
export const createPuzzle = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceCount: v.number(),
    difficulty: v.optional(v.union(v.literal("easy"), v.literal("medium"), v.literal("hard"), v.literal("expert"))),
    condition: v.union(v.literal("excellent"), v.literal("good"), v.literal("fair"), v.literal("poor")),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    images: v.array(v.string()),
    ownerId: v.id("users"),
    isCompleted: v.boolean(),
    completedDate: v.optional(v.number()),
    acquisitionDate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    const puzzleId = await ctx.db.insert("puzzles", {
      ...args,
      isAvailable: true, // New puzzles are available by default
      createdAt: now,
      updatedAt: now,
    });
    
    return puzzleId;
  },
});

// Get puzzle by ID
export const getPuzzleById = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args) => {
    const puzzle = await ctx.db.get(args.puzzleId);
    if (!puzzle) return null;
    
    // Get owner information
    const owner = await ctx.db.get(puzzle.ownerId);
    
    return {
      ...puzzle,
      owner: owner ? {
        _id: owner._id,
        name: owner.name,
        username: owner.username,
        avatar: owner.avatar,
      } : null,
    };
  },
});

// Get puzzles by owner
export const getPuzzlesByOwner = query({
  args: { 
    ownerId: v.id("users"),
    includeUnavailable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let puzzles = await ctx.db
      .query("puzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    
    if (!args.includeUnavailable) {
      puzzles = puzzles.filter(p => p.isAvailable);
    }
    
    return puzzles.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Browse available puzzles with filters
export const browsePuzzles = query({
  args: {
    category: v.optional(v.string()),
    minPieceCount: v.optional(v.number()),
    maxPieceCount: v.optional(v.number()),
    difficulty: v.optional(v.union(v.literal("easy"), v.literal("medium"), v.literal("hard"), v.literal("expert"))),
    condition: v.optional(v.union(v.literal("excellent"), v.literal("good"), v.literal("fair"), v.literal("poor"))),
    searchTerm: v.optional(v.string()),
    excludeOwnerId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;
    
    let puzzles = await ctx.db
      .query("puzzles")
      .withIndex("by_availability", (q) => q.eq("isAvailable", true))
      .collect();
    
    // Apply filters
    if (args.excludeOwnerId) {
      puzzles = puzzles.filter(p => p.ownerId !== args.excludeOwnerId);
    }
    
    if (args.category) {
      puzzles = puzzles.filter(p => p.category === args.category);
    }
    
    if (args.minPieceCount !== undefined) {
      puzzles = puzzles.filter(p => p.pieceCount >= args.minPieceCount!);
    }
    
    if (args.maxPieceCount !== undefined) {
      puzzles = puzzles.filter(p => p.pieceCount <= args.maxPieceCount!);
    }
    
    if (args.difficulty) {
      puzzles = puzzles.filter(p => p.difficulty === args.difficulty);
    }
    
    if (args.condition) {
      puzzles = puzzles.filter(p => p.condition === args.condition);
    }
    
    if (args.searchTerm) {
      const searchTerm = args.searchTerm.toLowerCase();
      puzzles = puzzles.filter(p => 
        p.title.toLowerCase().includes(searchTerm) ||
        (p.description && p.description.toLowerCase().includes(searchTerm)) ||
        (p.brand && p.brand.toLowerCase().includes(searchTerm)) ||
        (p.tags && p.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
      );
    }
    
    // Sort by creation date (newest first)
    puzzles.sort((a, b) => b.createdAt - a.createdAt);
    
    // Get owner information for each puzzle
    const puzzlesWithOwners = await Promise.all(
      puzzles.slice(offset, offset + limit).map(async (puzzle) => {
        const owner = await ctx.db.get(puzzle.ownerId);
        return {
          ...puzzle,
          owner: owner ? {
            _id: owner._id,
            name: owner.name,
            username: owner.username,
            avatar: owner.avatar,
          } : null,
        };
      })
    );
    
    return {
      puzzles: puzzlesWithOwners,
      total: puzzles.length,
      hasMore: offset + limit < puzzles.length,
    };
  },
});

// Update puzzle
export const updatePuzzle = mutation({
  args: {
    puzzleId: v.id("puzzles"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceCount: v.optional(v.number()),
    difficulty: v.optional(v.union(v.literal("easy"), v.literal("medium"), v.literal("hard"), v.literal("expert"))),
    condition: v.optional(v.union(v.literal("excellent"), v.literal("good"), v.literal("fair"), v.literal("poor"))),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    images: v.optional(v.array(v.string())),
    isAvailable: v.optional(v.boolean()),
    isCompleted: v.optional(v.boolean()),
    completedDate: v.optional(v.number()),
    acquisitionDate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { puzzleId, ...updates } = args;
    
    await ctx.db.patch(puzzleId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Delete puzzle
export const deletePuzzle = mutation({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, args) => {
    // Check if puzzle has any active trade requests
    const activeTradeRequests = await ctx.db
      .query("tradeRequests")
      .withIndex("by_owner_puzzle", (q) => q.eq("ownerPuzzleId", args.puzzleId))
      .filter((q) => q.neq(q.field("status"), "completed"))
      .filter((q) => q.neq(q.field("status"), "cancelled"))
      .filter((q) => q.neq(q.field("status"), "declined"))
      .collect();
    
    if (activeTradeRequests.length > 0) {
      throw new Error("Cannot delete puzzle with active trade requests");
    }
    
    await ctx.db.delete(args.puzzleId);
  },
});

// Get puzzle categories (for filters)
export const getPuzzleCategories = query({
  args: {},
  handler: async (ctx) => {
    const puzzles = await ctx.db.query("puzzles").collect();
    const categories = new Set<string>();
    
    puzzles.forEach(puzzle => {
      if (puzzle.category) {
        categories.add(puzzle.category);
      }
    });
    
    return Array.from(categories).sort();
  },
});

// Get popular tags
export const getPopularTags = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const puzzles = await ctx.db.query("puzzles").collect();
    const tagCounts = new Map<string, number>();
    
    puzzles.forEach(puzzle => {
      if (puzzle.tags) {
        puzzle.tags.forEach(tag => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      }
    });
    
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));
  },
});
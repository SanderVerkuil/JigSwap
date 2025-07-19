import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ============================================================================
// COLLECTION MANAGEMENT
// ============================================================================

// Add puzzle to user's collection
export const addToCollection = mutation({
  args: {
    puzzleId: v.id("puzzles"),
    visibility: v.union(
      v.literal("private"),
      v.literal("visible"),
      v.literal("lendable"),
      v.literal("swappable"),
      v.literal("tradeable"),
    ),
    customTags: v.optional(v.array(v.string())),
    personalNotes: v.optional(v.string()),
    acquisitionDate: v.optional(v.number()),
    acquisitionSource: v.optional(v.string()),
    acquisitionPrice: v.optional(v.number()),
    isWishlist: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
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

    // Check if puzzle is already in collection
    const existingCollection = await ctx.db
      .query("collections")
      .withIndex("by_user_puzzle", (q) =>
        q.eq("userId", user._id).eq("puzzleId", args.puzzleId),
      )
      .unique();

    if (existingCollection) {
      throw new Error("Puzzle already in collection");
    }

    const now = Date.now();
    const collectionId = await ctx.db.insert("collections", {
      userId: user._id,
      puzzleId: args.puzzleId,
      visibility: args.visibility,
      customTags: args.customTags,
      personalNotes: args.personalNotes,
      acquisitionDate: args.acquisitionDate,
      acquisitionSource: args.acquisitionSource,
      acquisitionPrice: args.acquisitionPrice,
      isWishlist: args.isWishlist ?? false,
      createdAt: now,
      updatedAt: now,
    });

    return collectionId;
  },
});

// Get user's collection
export const getCollection = query({
  args: {
    userId: v.optional(v.id("users")),
    includeWishlist: v.optional(v.boolean()),
    visibility: v.optional(
      v.union(
        v.literal("private"),
        v.literal("visible"),
        v.literal("lendable"),
        v.literal("swappable"),
        v.literal("tradeable"),
      ),
    ),
    searchTerm: v.optional(v.string()),
    category: v.optional(v.string()),
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
    tags: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!currentUser) {
      return null;
    }

    const userId = args.userId ?? currentUser._id;
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    let collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Filter by wishlist status
    if (args.includeWishlist !== undefined) {
      collections = collections.filter(
        (c) => c.isWishlist === args.includeWishlist,
      );
    }

    // Filter by visibility
    if (args.visibility) {
      collections = collections.filter((c) => c.visibility === args.visibility);
    }

    // Get puzzle details for each collection
    const collectionsWithPuzzles = await Promise.all(
      collections.map(async (collection) => {
        const puzzle = await ctx.db.get(collection.puzzleId);
        return {
          ...collection,
          puzzle: puzzle,
        };
      }),
    );

    // Apply filters
    let filteredCollections = collectionsWithPuzzles;

    if (args.searchTerm) {
      const searchTerm = args.searchTerm.toLowerCase();
      filteredCollections = filteredCollections.filter(
        (c) =>
          c.puzzle &&
          (c.puzzle.title.toLowerCase().includes(searchTerm) ||
            (c.puzzle.brand &&
              c.puzzle.brand.toLowerCase().includes(searchTerm)) ||
            (c.customTags &&
              c.customTags.some((tag) =>
                tag.toLowerCase().includes(searchTerm),
              ))),
      );
    }

    if (args.category) {
      filteredCollections = filteredCollections.filter(
        (c) => c.puzzle && c.puzzle.category === args.category,
      );
    }

    if (args.minPieceCount !== undefined) {
      filteredCollections = filteredCollections.filter(
        (c) => c.puzzle && c.puzzle.pieceCount >= args.minPieceCount!,
      );
    }

    if (args.maxPieceCount !== undefined) {
      filteredCollections = filteredCollections.filter(
        (c) => c.puzzle && c.puzzle.pieceCount <= args.maxPieceCount!,
      );
    }

    if (args.difficulty) {
      filteredCollections = filteredCollections.filter(
        (c) => c.puzzle && c.puzzle.difficulty === args.difficulty,
      );
    }

    if (args.tags && args.tags.length > 0) {
      filteredCollections = filteredCollections.filter(
        (c) =>
          c.customTags && args.tags!.some((tag) => c.customTags!.includes(tag)),
      );
    }

    // Sort by creation date (newest first)
    filteredCollections.sort((a, b) => b.createdAt - a.createdAt);

    return {
      collections: filteredCollections.slice(offset, offset + limit),
      total: filteredCollections.length,
      hasMore: offset + limit < filteredCollections.length,
    };
  },
});

// Update collection item
export const updateCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    visibility: v.optional(
      v.union(
        v.literal("private"),
        v.literal("visible"),
        v.literal("lendable"),
        v.literal("swappable"),
        v.literal("tradeable"),
      ),
    ),
    customTags: v.optional(v.array(v.string())),
    personalNotes: v.optional(v.string()),
    acquisitionDate: v.optional(v.number()),
    acquisitionSource: v.optional(v.string()),
    acquisitionPrice: v.optional(v.number()),
    isWishlist: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { collectionId, ...updates } = args;

    await ctx.db.patch(collectionId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Remove puzzle from collection
export const removeFromCollection = mutation({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.collectionId);
  },
});

// ============================================================================
// COMPLETION TRACKING
// ============================================================================

// Start a puzzle completion
export const startCompletion = mutation({
  args: {
    puzzleId: v.id("puzzles"),
    startDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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

    const now = Date.now();
    const completionId = await ctx.db.insert("completions", {
      userId: user._id,
      puzzleId: args.puzzleId,
      startDate: args.startDate ?? now,
      endDate: 0, // Will be set when completed
      completionTimeMinutes: 0, // Will be calculated when completed
      rating: undefined,
      review: undefined,
      notes: undefined,
      photos: [],
      isCompleted: false,
      createdAt: now,
      updatedAt: now,
    });

    return completionId;
  },
});

// Complete a puzzle
export const completePuzzle = mutation({
  args: {
    completionId: v.id("completions"),
    endDate: v.optional(v.number()),
    rating: v.optional(v.number()),
    review: v.optional(v.string()),
    notes: v.optional(v.string()),
    photos: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const completion = await ctx.db.get(args.completionId);
    if (!completion) {
      throw new Error("Completion not found");
    }

    const endDate = args.endDate ?? Date.now();
    const completionTimeMinutes = Math.round(
      (endDate - completion.startDate) / (1000 * 60),
    );

    await ctx.db.patch(args.completionId, {
      endDate,
      completionTimeMinutes,
      rating: args.rating,
      review: args.review,
      notes: args.notes,
      photos: args.photos ?? [],
      isCompleted: true,
      updatedAt: Date.now(),
    });
  },
});

// Get completion history for a puzzle
export const getCompletionHistory = query({
  args: { puzzleId: v.id("puzzles") },
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

    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user_puzzle", (q) =>
        q.eq("userId", user._id).eq("puzzleId", args.puzzleId),
      )
      .filter((q) => q.eq(q.field("isCompleted"), true))
      .order("desc")
      .collect();

    return completions.sort((a, b) => b.endDate - a.endDate);
  },
});

// Get user's completion statistics
export const getCompletionStats = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!currentUser) {
      return null;
    }

    const userId = args.userId ?? currentUser._id;

    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("isCompleted"), true))
      .collect();

    const totalCompletions = completions.length;
    const totalTimeMinutes = completions.reduce(
      (sum, c) => sum + c.completionTimeMinutes,
      0,
    );
    const averageTimeMinutes =
      totalCompletions > 0 ? totalTimeMinutes / totalCompletions : 0;
    const averageRating =
      totalCompletions > 0
        ? completions.reduce((sum, c) => sum + (c.rating ?? 0), 0) /
          totalCompletions
        : 0;

    // Get puzzles with completion details
    const completionsWithPuzzles = await Promise.all(
      completions.map(async (completion) => {
        const puzzle = await ctx.db.get(completion.puzzleId);
        return {
          ...completion,
          puzzle: puzzle,
        };
      }),
    );

    // Calculate brand distribution
    const brandCounts = new Map<string, number>();
    completionsWithPuzzles.forEach((c) => {
      if (c.puzzle?.brand) {
        brandCounts.set(
          c.puzzle.brand,
          (brandCounts.get(c.puzzle.brand) || 0) + 1,
        );
      }
    });

    // Calculate difficulty distribution
    const difficultyCounts = new Map<string, number>();
    completionsWithPuzzles.forEach((c) => {
      if (c.puzzle?.difficulty) {
        difficultyCounts.set(
          c.puzzle.difficulty,
          (difficultyCounts.get(c.puzzle.difficulty) || 0) + 1,
        );
      }
    });

    return {
      totalCompletions,
      totalTimeMinutes,
      averageTimeMinutes,
      averageRating: Math.round(averageRating * 10) / 10,
      brandDistribution: Array.from(brandCounts.entries()),
      difficultyDistribution: Array.from(difficultyCounts.entries()),
      recentCompletions: completions
        .sort((a, b) => b.endDate - a.endDate)
        .slice(0, 5),
    };
  },
});

// ============================================================================
// CATEGORIES
// ============================================================================

// Create a new category
export const createCategory = mutation({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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

    // Check if category name already exists for this user
    const existingCategory = await ctx.db
      .query("categories")
      .withIndex("by_user_name", (q) =>
        q.eq("userId", user._id).eq("name", args.name),
      )
      .unique();

    if (existingCategory) {
      throw new Error("Category already exists");
    }

    const now = Date.now();
    const categoryId = await ctx.db.insert("categories", {
      userId: user._id,
      name: args.name,
      color: args.color,
      description: args.description,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    return categoryId;
  },
});

// Get user's categories
export const getCategories = query({
  args: {},
  handler: async (ctx) => {
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

    const categories = await ctx.db
      .query("categories")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return categories.sort((a, b) => {
      // Default categories first, then alphabetically
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

// Update category
export const updateCategory = mutation({
  args: {
    categoryId: v.id("categories"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { categoryId, ...updates } = args;

    await ctx.db.patch(categoryId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Delete category
export const deleteCategory = mutation({
  args: { categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const category = await ctx.db.get(args.categoryId);
    if (!category) {
      throw new Error("Category not found");
    }

    if (category.isDefault) {
      throw new Error("Cannot delete default category");
    }

    await ctx.db.delete(args.categoryId);
  },
});

// ============================================================================
// GOALS
// ============================================================================

// Create a new goal
export const createGoal = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    targetCompletions: v.number(),
    targetDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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

    const now = Date.now();
    const goalId = await ctx.db.insert("goals", {
      userId: user._id,
      title: args.title,
      description: args.description,
      targetCompletions: args.targetCompletions,
      currentCompletions: 0,
      targetDate: args.targetDate,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return goalId;
  },
});

// Get user's goals
export const getGoals = query({
  args: { includeInactive: v.optional(v.boolean()) },
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

    let goals = await ctx.db
      .query("goals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    if (!args.includeInactive) {
      goals = goals.filter((g) => g.isActive);
    }

    return goals.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Update goal
export const updateGoal = mutation({
  args: {
    goalId: v.id("goals"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    targetCompletions: v.optional(v.number()),
    currentCompletions: v.optional(v.number()),
    targetDate: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { goalId, ...updates } = args;

    await ctx.db.patch(goalId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Delete goal
export const deleteGoal = mutation({
  args: { goalId: v.id("goals") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.goalId);
  },
});

// ============================================================================
// ANALYTICS
// ============================================================================

// Get comprehensive user analytics
export const getUserAnalytics = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!currentUser) {
      return null;
    }

    const userId = args.userId ?? currentUser._id;

    // Get collection stats
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const ownedPuzzles = collections.filter((c) => !c.isWishlist).length;
    const wishlistPuzzles = collections.filter((c) => c.isWishlist).length;

    // Get completion stats
    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("isCompleted"), true))
      .collect();

    const totalCompletions = completions.length;
    const totalTimeMinutes = completions.reduce(
      (sum, c) => sum + c.completionTimeMinutes,
      0,
    );
    const averageTimeMinutes =
      totalCompletions > 0 ? totalTimeMinutes / totalCompletions : 0;
    const averageRating =
      totalCompletions > 0
        ? completions.reduce((sum, c) => sum + (c.rating ?? 0), 0) /
          totalCompletions
        : 0;

    // Get puzzles with details for analysis
    const collectionsWithPuzzles = await Promise.all(
      collections.map(async (collection) => {
        const puzzle = await ctx.db.get(collection.puzzleId);
        return {
          ...collection,
          puzzle: puzzle,
        };
      }),
    );

    // Calculate piece count distribution
    const pieceCountDistribution = new Map<number, number>();
    collectionsWithPuzzles.forEach((c) => {
      if (c.puzzle?.pieceCount) {
        pieceCountDistribution.set(
          c.puzzle.pieceCount,
          (pieceCountDistribution.get(c.puzzle.pieceCount) || 0) + 1,
        );
      }
    });

    // Calculate brand distribution
    const brandDistribution = new Map<string, number>();
    collectionsWithPuzzles.forEach((c) => {
      if (c.puzzle?.brand) {
        brandDistribution.set(
          c.puzzle.brand,
          (brandDistribution.get(c.puzzle.brand) || 0) + 1,
        );
      }
    });

    // Calculate difficulty distribution
    const difficultyDistribution = new Map<string, number>();
    collectionsWithPuzzles.forEach((c) => {
      if (c.puzzle?.difficulty) {
        difficultyDistribution.set(
          c.puzzle.difficulty,
          (difficultyDistribution.get(c.puzzle.difficulty) || 0) + 1,
        );
      }
    });

    // Calculate monthly completion trends
    const monthlyCompletions = new Map<string, number>();
    completions.forEach((completion) => {
      const date = new Date(completion.endDate);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      monthlyCompletions.set(
        monthKey,
        (monthlyCompletions.get(monthKey) || 0) + 1,
      );
    });

    return {
      collection: {
        totalOwned: ownedPuzzles,
        totalWishlist: wishlistPuzzles,
        pieceCountDistribution: Array.from(pieceCountDistribution.entries()),
        brandDistribution: Array.from(brandDistribution.entries()),
        difficultyDistribution: Array.from(difficultyDistribution.entries()),
      },
      completions: {
        total: totalCompletions,
        totalTimeMinutes,
        averageTimeMinutes,
        averageRating: Math.round(averageRating * 10) / 10,
        monthlyTrends: Array.from(monthlyCompletions.entries()),
      },
    };
  },
});

// Export user data
export const exportUserData = query({
  args: {},
  handler: async (ctx) => {
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

    // Get all user data
    const collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const categories = await ctx.db
      .query("categories")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const goals = await ctx.db
      .query("goals")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    // Get puzzle details
    const collectionsWithPuzzles = await Promise.all(
      collections.map(async (collection) => {
        const puzzle = await ctx.db.get(collection.puzzleId);
        return {
          ...collection,
          puzzle: puzzle,
        };
      }),
    );

    const completionsWithPuzzles = await Promise.all(
      completions.map(async (completion) => {
        const puzzle = await ctx.db.get(completion.puzzleId);
        return {
          ...completion,
          puzzle: puzzle,
        };
      }),
    );

    return {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        username: user.username,
        bio: user.bio,
        location: user.location,
        createdAt: user.createdAt,
      },
      collections: collectionsWithPuzzles,
      completions: completionsWithPuzzles,
      categories,
      goals,
      exportDate: Date.now(),
    };
  },
});

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export type PuzzleSuggestion = {
  title: string;
  description?: string;
  brand?: string;
  tags?: string[];
};

// Create a new puzzle product
export const createPuzzleProduct = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceCount: v.number(),
    difficulty: v.optional(
      v.union(
        v.literal("easy"),
        v.literal("medium"),
        v.literal("hard"),
        v.literal("expert"),
      ),
    ),
    category: v.optional(v.id("adminCategories")),
    tags: v.optional(v.array(v.string())),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const searchableText = [
      args.title,
      args.description,
      args.brand,
      ...(args.tags || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const productId = await ctx.db.insert("puzzleProducts", {
      ...args,
      searchableText,
      createdAt: now,
      updatedAt: now,
    });

    return productId;
  },
});

// Create a new puzzle instance (owned copy)
export const createPuzzleInstance = mutation({
  args: {
    productId: v.id("puzzleProducts"),
    condition: v.union(
      v.literal("excellent"),
      v.literal("good"),
      v.literal("fair"),
      v.literal("poor"),
    ),
    isAvailable: v.boolean(),
    acquisitionDate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
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

    const instanceId = await ctx.db.insert("puzzleInstances", {
      ...args,
      ownerId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    return instanceId;
  },
});

// Get puzzle instances by owner
export const getPuzzleInstancesByOwner = query({
  args: {
    ownerId: v.id("users"),
    includeUnavailable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let instances = await ctx.db
      .query("puzzleInstances")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    if (!args.includeUnavailable) {
      instances = instances.filter((i) => i.isAvailable);
    }

    // Get product information for each instance
    const instancesWithProducts = await Promise.all(
      instances.map(async (instance) => {
        const product = await ctx.db.get(instance.productId);
        return {
          ...instance,
          product,
        };
      })
    );

    return instancesWithProducts.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Browse available puzzle instances with filters
export const browsePuzzleInstances = query({
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
        v.literal("excellent"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
      ),
    ),
    searchTerm: v.optional(v.string()),
    excludeOwnerId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;

    let instances = await ctx.db
      .query("puzzleInstances")
      .withIndex("by_availability", (q) => q.eq("isAvailable", true))
      .collect();

    // Apply filters
    if (args.excludeOwnerId) {
      instances = instances.filter((i) => i.ownerId !== args.excludeOwnerId);
    }

    if (args.condition) {
      instances = instances.filter((i) => i.condition === args.condition);
    }

    // Get product information for filtering
    const instancesWithProducts = await Promise.all(
      instances.map(async (instance) => {
        const product = await ctx.db.get(instance.productId);
        return {
          ...instance,
          product,
        };
      })
    );

    // Apply product-based filters
    let filteredInstances = instancesWithProducts;

    if (args.category) {
      filteredInstances = filteredInstances.filter(
        (i) => i.product?.category === args.category
      );
    }

    if (args.minPieceCount !== undefined) {
      filteredInstances = filteredInstances.filter(
        (i) => i.product && i.product.pieceCount >= args.minPieceCount!
      );
    }

    if (args.maxPieceCount !== undefined) {
      filteredInstances = filteredInstances.filter(
        (i) => i.product && i.product.pieceCount <= args.maxPieceCount!
      );
    }

    if (args.difficulty) {
      filteredInstances = filteredInstances.filter(
        (i) => i.product?.difficulty === args.difficulty
      );
    }

    if (args.searchTerm) {
      const searchTerm = args.searchTerm.toLowerCase();
      filteredInstances = filteredInstances.filter(
        (i) =>
          i.product &&
          (i.product.title.toLowerCase().includes(searchTerm) ||
            (i.product.description &&
              i.product.description.toLowerCase().includes(searchTerm)) ||
            (i.product.brand &&
              i.product.brand.toLowerCase().includes(searchTerm)) ||
            (i.product.tags &&
              i.product.tags.some((tag) =>
                tag.toLowerCase().includes(searchTerm)
              )))
      );
    }

    // Sort by creation date (newest first)
    filteredInstances.sort((a, b) => b.createdAt - a.createdAt);

    // Get owner information for each instance
    const instancesWithOwners = await Promise.all(
      filteredInstances.slice(offset, offset + limit).map(async (instance) => {
        const owner = await ctx.db.get(instance.ownerId);
        return {
          ...instance,
          owner: owner
            ? {
                _id: owner._id,
                name: owner.name,
                username: owner.username,
                avatar: owner.avatar,
              }
            : null,
        };
      })
    );

    return {
      instances: instancesWithOwners,
      total: filteredInstances.length,
      hasMore: offset + limit < filteredInstances.length,
    };
  },
});

// Update puzzle product
export const updatePuzzleProduct = mutation({
  args: {
    productId: v.id("puzzleProducts"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    brand: v.optional(v.string()),
    pieceCount: v.optional(v.number()),
    difficulty: v.optional(
      v.union(
        v.literal("easy"),
        v.literal("medium"),
        v.literal("hard"),
        v.literal("expert"),
      ),
    ),
    category: v.optional(v.id("adminCategories")),
    tags: v.optional(v.array(v.string())),
    images: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { productId, ...updates } = args;

    // Update searchable text if any text fields changed
    if (updates.title || updates.description || updates.brand || updates.tags) {
      const product = await ctx.db.get(productId);
      if (product) {
        const searchableText = [
          updates.title || product.title,
          updates.description || product.description,
          updates.brand || product.brand,
          ...(updates.tags || product.tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        (updates as any).searchableText = searchableText;
      }
    }

    await ctx.db.patch(productId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Update puzzle instance
export const updatePuzzleInstance = mutation({
  args: {
    instanceId: v.id("puzzleInstances"),
    condition: v.optional(
      v.union(
        v.literal("excellent"),
        v.literal("good"),
        v.literal("fair"),
        v.literal("poor"),
      ),
    ),
    isAvailable: v.optional(v.boolean()),
    acquisitionDate: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { instanceId, ...updates } = args;

    await ctx.db.patch(instanceId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Delete puzzle instance
export const deletePuzzleInstance = mutation({
  args: { instanceId: v.id("puzzleInstances") },
  handler: async (ctx, args) => {
    // Check if puzzle instance has any active trade requests
    const activeTradeRequests = await ctx.db
      .query("tradeRequests")
      .withIndex("by_owner_puzzle_instance", (q) => q.eq("ownerPuzzleInstanceId", args.instanceId))
      .filter((q) => q.neq(q.field("status"), "completed"))
      .filter((q) => q.neq(q.field("status"), "cancelled"))
      .filter((q) => q.neq(q.field("status"), "declined"))
      .collect();

    if (activeTradeRequests.length > 0) {
      throw new Error("Cannot delete puzzle instance with active trade requests");
    }

    await ctx.db.delete(args.instanceId);
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

// Get puzzle product suggestions for form auto-fill
export const getPuzzleProductSuggestions = query({
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

    const products = await ctx.db
      .query("puzzleProducts")
      .withSearchIndex("by_searchable_text", (q) =>
        q.search("searchableText", searchTerm),
      )
      .take(limit);

    return products;
  },
});

export const getPuzzleWithCollectionStatus = query({
  args: { puzzleId: v.id("puzzleInstances") },
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

    const instance = await ctx.db.get(args.puzzleId);
    if (!instance) return null;

    // Get product information
    const product = await ctx.db.get(instance.productId);
    if (!product) return null;

    // Get owner information
    const owner = await ctx.db.get(instance.ownerId);

    // Get collection status for current user
    const collection = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    // Get completion history for current user (for this specific instance)
    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user_puzzle_instance", (q) =>
        q.eq("userId", user._id).eq("puzzleInstanceId", args.puzzleId),
      )
      .filter((q) => q.eq(q.field("isCompleted"), true))
      .order("desc")
      .collect();

    return {
      ...instance,
      product,
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

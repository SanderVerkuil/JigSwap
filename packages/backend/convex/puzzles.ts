import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getManyVia } from "convex-helpers/server/relationships";

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
    images: v.array(v.string()),
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

// Find or create a puzzle product based on title, brand, and piece count
export const findOrCreatePuzzleProduct = mutation({
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
    images: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // First, try to find an existing product with the same title, brand, and piece count
    const existingProducts = await ctx.db
      .query("puzzleProducts")
      .withIndex("by_piece_count", (q) => q.eq("pieceCount", args.pieceCount))
      .collect();

    // Filter by title and brand (case-insensitive)
    const matchingProduct = existingProducts.find(product => {
      const titleMatch = product.title.toLowerCase() === args.title.toLowerCase();
      const brandMatch = (product.brand || "").toLowerCase() === (args.brand || "").toLowerCase();
      return titleMatch && brandMatch;
    });

    if (matchingProduct) {
      // Return existing product
      return matchingProduct._id;
    }

    // Create new product if none exists
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

// Create a puzzle instance with existing or new product
export const createPuzzleInstanceWithProduct = mutation({
  args: {
    // Product fields
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
    images: v.array(v.string()),
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
    
    // Extract product and instance fields
    const {
      condition,
      isAvailable,
      acquisitionDate,
      notes,
      ...productFields
    } = args;

    // Find or create the puzzle product
    // First, try to find an existing product with the same title, brand, and piece count
    const existingProducts = await ctx.db
      .query("puzzleProducts")
      .withIndex("by_piece_count", (q) => q.eq("pieceCount", productFields.pieceCount))
      .collect();

    // Filter by title and brand (case-insensitive)
    const matchingProduct = existingProducts.find(product => {
      const titleMatch = product.title.toLowerCase() === productFields.title.toLowerCase();
      const brandMatch = (product.brand || "").toLowerCase() === (productFields.brand || "").toLowerCase();
      return titleMatch && brandMatch;
    });

    let productId: any;
    
    if (matchingProduct) {
      // Use existing product
      productId = matchingProduct._id;
    } else {
      // Create new product if none exists
      const searchableText = [
        productFields.title,
        productFields.description,
        productFields.brand,
        ...(productFields.tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      productId = await ctx.db.insert("puzzleProducts", {
        ...productFields,
        searchableText,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Create the puzzle instance
    const instanceId = await ctx.db.insert("puzzleInstances", {
      productId,
      ownerId: user._id,
      condition,
      isAvailable,
      acquisitionDate,
      notes,
      createdAt: now,
      updatedAt: now,
    });

    return { productId, instanceId };
  },
});


export const browsePuzzles = query({
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

export const updatePuzzle = mutation({
  args: {
    puzzleId: v.id("puzzleInstances"),
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
    const { puzzleId, ...updates } = args;

    await ctx.db.patch(puzzleId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

export const deletePuzzle = mutation({
  args: { puzzleId: v.id("puzzleInstances") },
  handler: async (ctx, args) => {
    // Check if puzzle instance has any active trade requests
    const activeTradeRequests = await ctx.db
      .query("tradeRequests")
      .withIndex("by_owner_puzzle_instance", (q) => q.eq("ownerPuzzleInstanceId", args.puzzleId))
      .filter((q) => q.neq(q.field("status"), "completed"))
      .filter((q) => q.neq(q.field("status"), "cancelled"))
      .filter((q) => q.neq(q.field("status"), "declined"))
      .collect();

    if (activeTradeRequests.length > 0) {
      throw new Error("Cannot delete puzzle instance with active trade requests");
    }

    await ctx.db.delete(args.puzzleId);
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

export const getPuzzleStats = query({
  args: { puzzleId: v.id("puzzleInstances") },
  handler: async (ctx, args) => {
    const instance = await ctx.db.get(args.puzzleId);
    if (!instance) return null;
    
    const product = await ctx.db.get(instance.productId);
    if (!product) return null;

    // Get all instances of this product
    const instances = await ctx.db
      .query("puzzleInstances")
      .withIndex("by_product", (q) => q.eq("productId", instance.productId))
      .collect();

    // Get all completions for this product (both product-level and instance-level)
    const productCompletions = await ctx.db
      .query("completions")
      .withIndex("by_puzzle_product", (q) => q.eq("puzzleProductId", instance.productId))
      .filter((q) => q.eq(q.field("isCompleted"), true))
      .collect();

    // Get completions for each instance individually since 'in' operator doesn't exist
    const instanceCompletions = await Promise.all(
      instances.map(async (instance) => {
        return await ctx.db
          .query("completions")
          .withIndex("by_puzzle_instance", (q) => q.eq("puzzleInstanceId", instance._id))
          .filter((q) => q.eq(q.field("isCompleted"), true))
          .collect();
      })
    );
    const flatInstanceCompletions = instanceCompletions.flat();

    // Combine all completions
    const allCompletions = [...productCompletions, ...flatInstanceCompletions];

    // Get collections for this product - handle each instance separately
    const collections = await Promise.all(
      instances.map(async (instance) => {
        return await getManyVia(
          ctx.db,
          "collectionMembers",
          "puzzleInstanceId",
          "by_puzzle_instance",
          instance._id,
          "puzzleInstanceId"
        );
      })
    );
    const flatCollections = collections.flat();

    const totalInstances = instances.length;
    const totalCompletions = allCompletions.length;
    const totalCollections = collections.length;
    const averageRating =
      totalCompletions > 0
        ? allCompletions.reduce((sum, c) => sum + (c.rating ?? 0), 0) /
          totalCompletions
        : 0;
    const averageTimeMinutes =
      totalCompletions > 0
        ? allCompletions.reduce((sum, c) => sum + c.completionTimeMinutes, 0) /
          totalCompletions
        : 0;

    return {
      product,
      stats: {
        totalInstances,
        totalCompletions,
        totalCollections,
        averageRating: Math.round(averageRating * 10) / 10,
        averageTimeMinutes: Math.round(averageTimeMinutes),
        completionHistory: allCompletions.sort((a, b) => b.endDate - a.endDate),
      },
    };
  },
});


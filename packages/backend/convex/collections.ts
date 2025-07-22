import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ============================================================================
// COLLECTION MANAGEMENT
// ============================================================================

// Create a new collection
export const createCollection = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    visibility: v.union(
      v.literal("private"),
      v.literal("public"),
    ),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
    personalNotes: v.optional(v.string()),
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

    // Check if collection name already exists for this user
    const existingCollection = await ctx.db
      .query("collections")
      .withIndex("by_user_name", (q) =>
        q.eq("userId", user._id).eq("name", args.name),
      )
      .unique();

    if (existingCollection) {
      throw new Error("Collection with this name already exists");
    }

    const now = Date.now();
    const collectionId = await ctx.db.insert("collections", {
      userId: user._id,
      name: args.name,
      description: args.description,
      visibility: args.visibility,
      color: args.color,
      icon: args.icon,
      isDefault: false,
      personalNotes: args.personalNotes,
      createdAt: now,
      updatedAt: now,
    });

    return collectionId;
  },
});

// Get user's collections
export const getUserCollections = query({
  args: {
    userId: v.optional(v.id("users")),
    includePublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!currentUser) {
      throw new Error("User not found");
    }

    const targetUserId = args.userId || currentUser._id;

    let collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", targetUserId))
      .collect();

    // If requesting public collections, include them
    if (args.includePublic && targetUserId !== currentUser._id) {
      const publicCollections = await ctx.db
        .query("collections")
        .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
        .collect();
      
      collections = [...collections, ...publicCollections];
    }

    // Get puzzle counts for each collection
    const collectionsWithCounts = await Promise.all(
      collections.map(async (collection) => {
        const memberCount = await ctx.db
          .query("collectionMembers")
          .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
          .collect();
        
        return {
          ...collection,
          puzzleCount: memberCount.length,
        };
      })
    );

    return collectionsWithCounts.sort((a, b) => {
      // Default collections first, then by name
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

// Get collection by ID with members
export const getCollectionById = query({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, args) => {
    const collection = await ctx.db.get(args.collectionId);
    if (!collection) return null;

    // Get collection members with puzzle details
    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_collection", (q) => q.eq("collectionId", args.collectionId))
      .collect();

    const puzzles = await Promise.all(
      members.map(async (member) => {
        const puzzleInstance = member.puzzleInstanceId ? await ctx.db.get(member.puzzleInstanceId) : null;
        const product = puzzleInstance !== null ? await ctx.db.get(puzzleInstance.productId) : null;
        return puzzleInstance ? { ...puzzleInstance, addedAt: member.addedAt, product } : null;
      })
    );

    return {
      ...collection,
      puzzles: puzzles.filter(Boolean).filter((p) => p !== null),
    };
  },
});

// Add puzzle to collection
export const addPuzzleInstanceToCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    puzzleInstanceId: v.id("puzzleInstances"),
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

    // Verify collection exists and user owns it
    const collection = await ctx.db.get(args.collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }

    if (collection.userId !== user._id) {
      throw new Error("Not authorized to modify this collection");
    }

    // Check if puzzle is already in collection
    const existingMember = await ctx.db
      .query("collectionMembers")
      .withIndex("by_collection_puzzle_instance", (q) =>
        q.eq("collectionId", args.collectionId).eq("puzzleInstanceId", args.puzzleInstanceId),
      )
      .unique();

    if (existingMember) {
      throw new Error("Puzzle already in collection");
    }

    const now = Date.now();
    await ctx.db.insert("collectionMembers", {
      collectionId: args.collectionId,
      puzzleInstanceId: args.puzzleInstanceId,
      addedAt: now,
    });

    return { success: true };
  },
});

// Remove puzzle from collection
export const removePuzzleInstanceFromCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    puzzleInstanceId: v.id("puzzleInstances"),
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

    // Verify collection exists and user owns it
    const collection = await ctx.db.get(args.collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }

    if (collection.userId !== user._id) {
      throw new Error("Not authorized to modify this collection");
    }

    // Find and delete the membership
    const member = await ctx.db
      .query("collectionMembers")
      .withIndex("by_collection_puzzle_instance", (q) =>
        q.eq("collectionId", args.collectionId).eq("puzzleInstanceId", args.puzzleInstanceId),
      )
      .unique();

    if (!member) {
      throw new Error("Puzzle not in collection");
    }

    await ctx.db.delete(member._id);
    return { success: true };
  },
});

// Update collection
export const updateCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    visibility: v.optional(
      v.union(
        v.literal("private"),
        v.literal("public"),
      ),
    ),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
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

    const collection = await ctx.db.get(args.collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }

    if (collection.userId !== user._id) {
      throw new Error("Not authorized to modify this collection");
    }

    // If updating name, check for conflicts
    if (args.name && args.name !== collection.name) {
      const existingCollection = await ctx.db
        .query("collections")
        .withIndex("by_user_name", (q) =>
          q.eq("userId", user._id).eq("name", args.name ?? ""),
        )
        .unique();

      if (existingCollection) {
        throw new Error("Collection with this name already exists");
      }
    }

    const updates: {
      updatedAt: number;
      name?: string;
      description?: string;
      visibility?: "private" | "public";
      color?: string;
      icon?: string;
    } = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.visibility !== undefined) updates.visibility = args.visibility;
    if (args.color !== undefined) updates.color = args.color;
    if (args.icon !== undefined) updates.icon = args.icon;

    await ctx.db.patch(args.collectionId, updates);
    return { success: true };
  },
});

// Delete collection
export const deleteCollection = mutation({
  args: { collectionId: v.id("collections") },
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

    const collection = await ctx.db.get(args.collectionId);
    if (!collection) {
      throw new Error("Collection not found");
    }

    if (collection.userId !== user._id) {
      throw new Error("Not authorized to delete this collection");
    }

    if (collection.isDefault) {
      throw new Error("Cannot delete default collections");
    }

    // Delete all collection members
    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_collection", (q) => q.eq("collectionId", args.collectionId))
      .collect();

    for (const member of members) {
      await ctx.db.delete(member._id);
    }

    // Delete the collection
    await ctx.db.delete(args.collectionId);
    return { success: true };
  },
});

// Get collections that contain a specific puzzle
export const getCollectionsForPuzzleInstance = query({
  args: { puzzleInstanceId: v.id("puzzleInstances") },
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

    // Get all collections that contain this puzzle
    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_puzzle_instance", (q) => q.eq("puzzleInstanceId", args.puzzleInstanceId))
      .collect();

    const collections = await Promise.all(
      members.map(async (member) => {
        const collection = await ctx.db.get(member.collectionId);
        return collection && collection.userId === user._id ? collection : null;
      })
    );

    return collections.filter(Boolean);
  },
}); 
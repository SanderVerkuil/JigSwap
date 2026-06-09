import { v } from "convex/values";
import { query } from "./_generated/server";

// ============================================================================
// COLLECTION READS
// ============================================================================
// Collection WRITES (create/update/delete + add/remove copy) now live in the domain-driven
// `library/` module; only the read queries remain here.

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
          .withIndex("by_collection", (q) =>
            q.eq("collectionId", collection._id),
          )
          .collect();

        return {
          ...collection,
          puzzleCount: memberCount.length,
        };
      }),
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
      .withIndex("by_collection", (q) =>
        q.eq("collectionId", args.collectionId),
      )
      .collect();

    const puzzles = await Promise.all(
      members.map(async (member) => {
        const ownedPuzzle = member.ownedPuzzleId
          ? await ctx.db.get(member.ownedPuzzleId)
          : null;
        const puzzle =
          ownedPuzzle !== null ? await ctx.db.get(ownedPuzzle.puzzleId) : null;
        return ownedPuzzle
          ? { ...ownedPuzzle, addedAt: member.addedAt, puzzle }
          : null;
      }),
    );

    return {
      ...collection,
      puzzles: puzzles.filter(Boolean).filter((p) => p !== null),
    };
  },
});

// Get collections that contain a specific puzzle
export const getCollectionsForOwnedPuzzle = query({
  args: { ownedPuzzleId: v.id("ownedPuzzles") },
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
      .withIndex("by_owned_puzzle", (q) =>
        q.eq("ownedPuzzleId", args.ownedPuzzleId),
      )
      .collect();

    const collections = await Promise.all(
      members.map(async (member) => {
        const collection = await ctx.db.get(member.collectionId);
        return collection && collection.userId === user._id ? collection : null;
      }),
    );

    return collections.filter(Boolean);
  },
});

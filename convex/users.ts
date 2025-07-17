import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Create or update user from Clerk
export const createOrUpdateUser = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    name: v.string(),
    username: v.optional(v.string()),
    avatar: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    const now = Date.now();

    if (existingUser) {
      // Update existing user
      await ctx.db.patch(existingUser._id, {
        email: args.email,
        name: args.name,
        username: args.username,
        avatar: args.avatar,
        updatedAt: now,
      });
      return existingUser._id;
    } else {
      // Create new user
      const userId = await ctx.db.insert("users", {
        clerkId: args.clerkId,
        email: args.email,
        name: args.name,
        username: args.username,
        avatar: args.avatar,
        bio: undefined,
        location: undefined,
        preferredLanguage: "en",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      return userId;
    }
  },
});

// Get user by Clerk ID
export const getUserByClerkId = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
  },
});

// Get user by ID
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

// Update user profile
export const updateUserProfile = mutation({
  args: {
    userId: v.id("users"),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()),
    username: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, ...updates } = args;
    
    // Check if username is already taken (if provided)
    if (updates.username) {
      const existingUser = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", updates.username))
        .unique();
      
      if (existingUser && existingUser._id !== userId) {
        throw new Error("Username already taken");
      }
    }

    await ctx.db.patch(userId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

// Get user stats (puzzles owned, trades completed, etc.)
export const getUserStats = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const puzzlesOwned = await ctx.db
      .query("puzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
      .collect();

    const tradesAsRequester = await ctx.db
      .query("tradeRequests")
      .withIndex("by_requester", (q) => q.eq("requesterId", args.userId))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    const tradesAsOwner = await ctx.db
      .query("tradeRequests")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_reviewee", (q) => q.eq("revieweeId", args.userId))
      .collect();

    const averageRating = reviews.length > 0 
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length 
      : 0;

    return {
      puzzlesOwned: puzzlesOwned.length,
      puzzlesAvailable: puzzlesOwned.filter(p => p.isAvailable).length,
      tradesCompleted: tradesAsRequester.length + tradesAsOwner.length,
      averageRating: Math.round(averageRating * 10) / 10,
      totalReviews: reviews.length,
    };
  },
});

// Search users
export const searchUsers = query({
  args: { 
    searchTerm: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const searchTerm = args.searchTerm.toLowerCase();

    const users = await ctx.db.query("users").collect();
    
    return users
      .filter(user => 
        user.name.toLowerCase().includes(searchTerm) ||
        (user.username && user.username.toLowerCase().includes(searchTerm)) ||
        (user.location && user.location.toLowerCase().includes(searchTerm))
      )
      .slice(0, limit);
  },
});
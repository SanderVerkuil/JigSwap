import { UserJSON } from "@clerk/backend";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  QueryCtx,
} from "./_generated/server";

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

// Reads (getUserByClerkId, getCurrentUser, getGlobalStats, getUserById, getUserStats, searchUsers)
// were cut over to thin driving adapters under convex/identity/* and convex/insights/getGlobalStats
// (returning typed view DTOs from @jigswap/contracts). Only writes + internal helpers remain here.

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

/** Get user by Clerk use id (AKA "subject" on auth)  */
export const getUser = internalQuery({
  args: { subject: v.string() },
  async handler(ctx, args) {
    return await userQuery(ctx, args.subject);
  },
});

/** Create a new Clerk user or update existing Clerk user data. */
export const updateOrCreateUser = internalMutation({
  args: { clerkUser: v.any() }, // no runtime validation, trust Clerk
  async handler(ctx, { clerkUser }: { clerkUser: UserJSON }) {
    const userRecord = await userQuery(ctx, clerkUser.id);

    if (userRecord === null) {
      await ctx.db.insert("users", {
        clerkId: clerkUser.id,
        email: clerkUser.email_addresses[0].email_address,
        name: `${clerkUser.first_name} ${clerkUser.last_name}`,
        username: clerkUser.username ?? undefined,
        avatar: clerkUser.image_url,
        bio: undefined,
        isActive: true,
        createdAt: clerkUser.created_at,
        updatedAt: clerkUser.updated_at,
      });
    } else {
      await ctx.db.patch(userRecord._id, {
        clerkId: clerkUser.id,
        email: clerkUser.email_addresses[0].email_address,
        name: `${clerkUser.first_name} ${clerkUser.last_name}`,
        username: clerkUser.username ?? undefined,
        avatar: clerkUser.image_url,
        updatedAt: clerkUser.updated_at,
      });
    }
  },
});

/** Delete a user by clerk user ID. */
export const deleteUser = internalMutation({
  args: { id: v.string() },
  async handler(ctx, { id }) {
    const userRecord = await userQuery(ctx, id);

    if (userRecord === null) {
      console.warn("can't delete user, does not exist", id);
    } else {
      await ctx.db.delete(userRecord._id);
    }
  },
});

export async function userQuery(
  ctx: QueryCtx,
  clerkUserId: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkUserId))
    .unique();
}

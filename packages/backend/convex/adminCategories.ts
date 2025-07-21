import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Get all admin categories (for admin panel)
export const getAllAdminCategories = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("adminCategories")
      .order("asc")
      .collect();
  },
});

// Get active admin categories (for public use)
export const getActiveAdminCategories = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("adminCategories")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .order("asc")
      .collect();
  },
});

// Get admin category by ID
export const getAdminCategoryById = query({
  args: { id: v.id("adminCategories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Create new admin category
export const createAdminCategory = mutation({
  args: {
    name: v.object({
      en: v.string(),
      nl: v.string(),
    }),
    description: v.optional(v.object({
      en: v.string(),
      nl: v.string(),
    })),
    color: v.optional(v.string()),
    isActive: v.boolean(),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    return await ctx.db.insert("adminCategories", {
      name: args.name,
      description: args.description,
      color: args.color,
      isActive: args.isActive,
      sortOrder: args.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// Update admin category
export const updateAdminCategory = mutation({
  args: {
    id: v.id("adminCategories"),
    name: v.optional(v.object({
      en: v.string(),
      nl: v.string(),
    })),
    description: v.optional(v.object({
      en: v.string(),
      nl: v.string(),
    })),
    color: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const now = Date.now();
    
    await ctx.db.patch(id, {
      ...updates,
      updatedAt: now,
    });
    
    return id;
  },
});

// Delete admin category
export const deleteAdminCategory = mutation({
  args: { id: v.id("adminCategories") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return args.id;
  },
});

// Reorder admin categories
export const reorderAdminCategories = mutation({
  args: {
    categoryIds: v.array(v.id("adminCategories")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    for (let i = 0; i < args.categoryIds.length; i++) {
      await ctx.db.patch(args.categoryIds[i], {
        sortOrder: i,
        updatedAt: now,
      });
    }
    
    return args.categoryIds;
  },
}); 
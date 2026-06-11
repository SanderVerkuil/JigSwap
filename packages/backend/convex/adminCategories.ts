import { v } from "convex/values";
import { query } from "./_generated/server";

// Get all admin categories (for admin panel)
export const getAllAdminCategories = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("adminCategories").order("asc").collect();
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

// Category writes now live in the domain-driven catalog module (catalog/*CatalogCategory). The
// legacy create/update/delete/reorder mutations were retired in the 2d catalog cutover.

import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { byCategoryOrder } from "./catalog/mappers";
import { isAdmin } from "./identity/isAdmin";
import { requireMember } from "./identity/requireMember";

// Get all admin categories (for admin panel). Admin-only: returns ALL categories including the
// inactive/hidden ones, so it is gated like the sibling catalog admin reads/mutations
// (requireMember + isAdmin). The public surface is getActiveAdminCategories below.
export const getAllAdminCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    return await ctx.db.query("adminCategories").order("asc").collect();
  },
});

// Get active admin categories (for public use), in the admin-set sortOrder (ties by English name)
export const getActiveAdminCategories = query({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db
      .query("adminCategories")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    return categories.sort(byCategoryOrder);
  },
});

// Get admin category by ID. Admin-only (can resolve inactive/hidden rows), matching
// getAllAdminCategories and the catalog admin reads.
export const getAdminCategoryById = query({
  args: { id: v.id("adminCategories") },
  handler: async (ctx, args) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    return await ctx.db.get(args.id);
  },
});

// Category writes now live in the domain-driven catalog module (catalog/*CatalogCategory). The
// legacy create/update/delete/reorder mutations were retired in the 2d catalog cutover.

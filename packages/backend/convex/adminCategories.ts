import { query } from "./_generated/server";
import { requireAdmin } from "./identity/isAdmin";

// Get all admin categories (for admin panel). Admin-only: returns ALL categories including the
// inactive/hidden ones, so it is gated like the sibling catalog admin reads/mutations
// (requireAdmin). The public taxonomy is catalog/getPuzzleCategories.
export const getAllAdminCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("adminCategories").order("asc").collect();
  },
});

// Category writes now live in the domain-driven catalog module (catalog/*CatalogCategory). The
// legacy create/update/delete/reorder mutations were retired in the 2d catalog cutover.

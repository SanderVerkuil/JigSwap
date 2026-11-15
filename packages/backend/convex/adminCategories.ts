import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { isAdmin } from "./identity/isAdmin";
import { requireMember } from "./identity/requireMember";

// Get all admin categories (for admin panel). Admin-only: returns ALL categories including the
// inactive/hidden ones, so it is gated like the sibling catalog admin reads/mutations
// (requireMember + isAdmin). The public taxonomy is catalog/getPuzzleCategories.
export const getAllAdminCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");
    return await ctx.db.query("adminCategories").order("asc").collect();
  },
});

// Category writes now live in the domain-driven catalog module (catalog/*CatalogCategory). The
// legacy create/update/delete/reorder mutations were retired in the 2d catalog cutover.

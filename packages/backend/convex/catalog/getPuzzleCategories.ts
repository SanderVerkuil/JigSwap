import type { PuzzleCategoryView } from "@jigswap/contracts";
import { query } from "../_generated/server";
import { byCategoryOrder, toPuzzleCategoryView } from "./mappers";

// Catalog read: the active category taxonomy used by browse/add filters. Active-only, in the
// admin-set sortOrder (ties by English name); rows map to typed category DTOs.
export const getPuzzleCategories = query({
  args: {},
  handler: async (ctx): Promise<PuzzleCategoryView[]> => {
    const categories = await ctx.db
      .query("adminCategories")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();

    return categories.sort(byCategoryOrder).map(toPuzzleCategoryView);
  },
});

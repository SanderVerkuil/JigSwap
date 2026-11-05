import type { BrandView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { query } from "../_generated/server";
import schema from "../schema";

// Catalog read: the distinct brand names for the filter dropdown. Distinct over the by_brand index,
// restricted to approved puzzles so brand free-text from pending/rejected submissions never leaks
// into the public filter UI (consistent with every sibling catalog read). Brand is optional in the
// catalog: brand-less and blank-brand rows are skipped, because `undefined` is not a Convex value
// (returning it fails the whole query) and a blank name is not a choosable brand.
export const getAllBrands = query({
  args: {},
  handler: async (ctx): Promise<BrandView[]> => {
    const brands = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_brand", (q) => q)
      // filterWith (not .filter, which streams reject) is applied before distinct.
      .filterWith(async (p) => p.status === "approved")
      .distinct(["brand"])
      .collect();
    return brands.flatMap(({ brand }) => (brand?.trim() ? [brand] : []));
  },
});

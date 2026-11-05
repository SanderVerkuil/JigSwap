import type { BrandView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { query } from "../_generated/server";
import schema from "../schema";

// Catalog read: the distinct brand names for the filter dropdown. Distinct over the approved rows of
// by_status_brand, so brand free-text from pending/rejected submissions never leaks into the public
// filter UI (consistent with every sibling catalog read) and a flood of them costs this public read
// nothing (SEC-26). Brand is optional in the
// catalog: brand-less and blank-brand rows are skipped, because `undefined` is not a Convex value
// (returning it fails the whole query) and a blank name is not a choosable brand.
export const getAllBrands = query({
  args: {},
  handler: async (ctx): Promise<BrandView[]> => {
    const brands = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_status_brand", (q) => q.eq("status", "approved"))
      .distinct(["brand"])
      .collect();
    return brands.flatMap(({ brand }) => (brand?.trim() ? [brand] : []));
  },
});

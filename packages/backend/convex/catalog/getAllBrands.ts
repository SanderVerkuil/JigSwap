import type { BrandView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { query } from "../_generated/server";
import schema from "../schema";

// Catalog read: the distinct brand names for the filter dropdown. Logic preserved from legacy
// puzzles.getAllBrands (distinct over the by_brand index). Brand is optional in the catalog, so the
// list may contain `undefined` entries — the UI renders those as an empty option, as it does today.
export const getAllBrands = query({
  args: {},
  handler: async (ctx): Promise<BrandView[]> => {
    const brands = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_brand", (q) => q)
      .distinct(["brand"])
      .collect();
    return brands.map((brand) => brand.brand);
  },
});

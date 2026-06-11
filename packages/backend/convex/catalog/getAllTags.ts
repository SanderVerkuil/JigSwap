import type { TagView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { query } from "../_generated/server";
import schema from "../schema";

// Catalog read: the distinct, flattened, de-duplicated tag set for the filter UI. Logic preserved
// from legacy puzzles.getAllTags (distinct over by_tags, then flatten + dedupe).
export const getAllTags = query({
  args: {},
  handler: async (ctx): Promise<TagView[]> => {
    const tags = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_tags", (q) => q)
      .distinct(["tags"])
      .collect();
    return tags
      .map((tag) => tag.tags)
      .flat()
      .filter((t) => t !== undefined)
      .reduce((acc, tag) => {
        if (tag && !acc.includes(tag)) acc.push(tag);
        return acc;
      }, [] as TagView[]);
  },
});

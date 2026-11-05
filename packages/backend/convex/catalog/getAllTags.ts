import type { TagView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { query } from "../_generated/server";
import schema from "../schema";

// Catalog read: the distinct, flattened, de-duplicated tag set for the filter UI (distinct over
// the approved rows of by_status_tags, then flatten + dedupe). Tag free-text from pending/rejected
// submissions never leaks into the public filter UI (consistent with every sibling catalog read).
export const getAllTags = query({
  args: {},
  handler: async (ctx): Promise<TagView[]> => {
    const tags = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_status_tags", (q) => q.eq("status", "approved"))
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

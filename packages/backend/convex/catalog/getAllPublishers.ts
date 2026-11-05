import type { PublisherView } from "@jigswap/contracts";
import { KNOWN_PUBLISHERS } from "@jigswap/domain";
import { stream } from "convex-helpers/server/stream";
import { query } from "../_generated/server";
import schema from "../schema";

// Catalog read: publisher suggestions for the definition forms. Distinct publisher values over
// the approved rows of by_status_publisher (matching every sibling catalog read) MERGED with
// the domain's curated known-publishers allowlist, so suggestions are useful before any data
// carries a publisher. Case-insensitive dedupe; the allowlist's canonical casing wins.
export const getAllPublishers = query({
  args: {},
  handler: async (ctx): Promise<PublisherView[]> => {
    const rows = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_status_publisher", (q) => q.eq("status", "approved"))
      .distinct(["publisher"])
      .collect();

    const byLower = new Map<string, string>();
    for (const name of KNOWN_PUBLISHERS) byLower.set(name.toLowerCase(), name);
    for (const row of rows) {
      const value = row.publisher;
      if (!value) continue;
      if (!byLower.has(value.toLowerCase()))
        byLower.set(value.toLowerCase(), value);
    }
    return [...byLower.values()].sort((a, b) => a.localeCompare(b));
  },
});

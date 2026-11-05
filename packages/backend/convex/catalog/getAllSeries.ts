import type { SeriesView } from "@jigswap/contracts";
import { stream } from "convex-helpers/server/stream";
import { v } from "convex/values";
import { query } from "../_generated/server";
import schema from "../schema";

// Catalog read: series suggestions for the definition forms, scoped to the maker the member
// already entered so a Wasgij puzzle suggests Wasgij series, not Jan van Haasteren ones.
// Scope precedence: brand, else publisher, else (or when the scoped list is empty) ALL distinct
// series. Approved puzzles only, matching every sibling catalog read.
export const getAllSeries = query({
  args: {
    brand: v.optional(v.string()),
    publisher: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SeriesView[]> => {
    // Scoped path: collect + dedupe in JS. A brand or publisher reads only its APPROVED puzzles,
    // through by_status_brand or by_status_publisher.
    if (args.brand || args.publisher) {
      const rows = args.brand
        ? await ctx.db
            .query("puzzles")
            .withIndex("by_status_brand", (q) =>
              q.eq("status", "approved").eq("brand", args.brand),
            )
            .collect()
        : await ctx.db
            .query("puzzles")
            .withIndex("by_status_publisher", (q) =>
              q.eq("status", "approved").eq("publisher", args.publisher),
            )
            .collect();
      const scoped = [
        ...new Set(rows.map((p) => p.series).filter((s): s is string => !!s)),
      ].sort((a, b) => a.localeCompare(b));
      if (scoped.length > 0) return scoped;
      // Unknown maker (or no series recorded for it yet): fall through to the global list.
      // Deliberately global, not the next scope tier — a brand typo with a valid publisher
      // supplied still gets broad suggestions rather than none.
    }

    const rows = await stream(ctx.db, schema)
      .query("puzzles")
      .withIndex("by_status_series", (q) => q.eq("status", "approved"))
      .distinct(["series"])
      .collect();
    return rows
      .map((row) => row.series)
      .filter((s): s is string => !!s)
      .sort((a, b) => a.localeCompare(b));
  },
});

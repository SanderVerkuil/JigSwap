import type { MyShelfView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { clampLimit } from "../lib/pageSize";
import { toOwnedCopyView } from "./mappers";
import { readMemberLibraryCounts } from "./memberLibraryCounts";
import { resolveCopyCoverUrl } from "./resolveCoverUrl";

const DEFAULT_SHELF_SIZE = 6;
const MAX_SHELF_SIZE = 12;

// How many of the newest rows the shelf reads to pick its copies. by_owner orders by _creationTime
// and the shelf by `createdAt`; the two only part for rows written outside the normal add paths, so
// a small margin over the largest shelf is enough.
const SHELF_WINDOW = 50;

// Library read: the signed-in member's OWN shelf summary for the dashboard and profile shelves.
// Self-only (the caller comes from requireMember, never from an argument), so owner-only fields
// stay on. `total` and `forTrade` span the whole library, private copies included, and come from
// the member's counters (library/memberLibraryCounts), so this read covers one counter row plus the
// newest rows: editing an older copy, or anything that moves neither number, doesn't re-run it. Only
// the newest `limit` copies by createdAt (default 6, at most 12) are joined to their puzzle and cover.
export const getMyShelf = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<MyShelfView> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    const limit = clampLimit(args.limit, {
      fallback: DEFAULT_SHELF_SIZE,
      max: MAX_SHELF_SIZE,
    });

    const counts = await readMemberLibraryCounts(ctx, memberId);

    // Newest first (by_owner ends in _creationTime).
    const window = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
      .order("desc")
      .take(SHELF_WINDOW);

    const newest = window
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    const recent = await Promise.all(
      newest.map(async (copy) => {
        const puzzle = await ctx.db.get(copy.puzzleId);
        return toOwnedCopyView(copy, puzzle, {
          coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
          includeOwnerOnly: true,
        });
      }),
    );

    return {
      total: counts.owned,
      forTrade: counts.forTrade,
      recent,
    };
  },
});

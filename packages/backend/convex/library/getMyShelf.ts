import type { MyShelfView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { clampLimit } from "../lib/pageSize";
import { toOwnedCopyView } from "./mappers";
import { resolveCopyCoverUrl } from "./resolveCoverUrl";

// Bound for the counting scan. No real member comes close to 5000 copies (the same bound as
// identity/getUserStats); past it the counts undercount rather than the read failing.
export const MY_SHELF_SCAN_CAP = 5000;

const DEFAULT_SHELF_SIZE = 6;
const MAX_SHELF_SIZE = 12;

// Library read: the signed-in member's OWN shelf summary for the dashboard and profile shelves.
// Self-only (the caller comes from requireMember, never from an argument), so owner-only fields
// stay on. `total` and `forTrade` span the whole library, private copies included, from one
// by_owner scan; only the newest `limit` copies by createdAt (default 6, at most 12) are joined to
// their puzzle and cover, so a shelf never subscribes to the whole joined library.
export const getMyShelf = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<MyShelfView> => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    const limit = clampLimit(args.limit, {
      fallback: DEFAULT_SHELF_SIZE,
      max: MAX_SHELF_SIZE,
    });

    const owned = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", memberId))
      .take(MY_SHELF_SCAN_CAP);

    const newest = [...owned]
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
      total: owned.length,
      forTrade: owned.filter((copy) => copy.availability.forTrade).length,
      recent,
    };
  },
});

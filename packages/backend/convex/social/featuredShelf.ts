import type { OwnedCopyView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { toOwnedCopyView } from "../library/mappers";

// Social read: the curated, ordered set of owned copies a member has featured on their profile
// shelf. Returns them in the stored order and skips any entry that no longer exists or is no longer
// owned by `userId` (defensive; ownership could have changed since curation). Returns [] when
// the member has no profile or has not curated their shelf (caller falls back to recent-6).
export const featuredShelf = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<OwnedCopyView[]> => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_member", (q) =>
        q.eq("memberId", args.userId as Id<"users">),
      )
      .unique();

    if (!profile || !profile.featuredCopyIds?.length) {
      return [];
    }

    const results: OwnedCopyView[] = [];

    for (const copyId of profile.featuredCopyIds) {
      const copy = await ctx.db.get(copyId);
      // Skip entries that no longer exist or are no longer owned by the profile member.
      if (!copy || copy.ownerId !== args.userId) continue;

      const puzzle = await ctx.db.get(copy.puzzleId);

      // Resolve cover: approved copy photo first, then puzzle box art.
      let coverUrl: string | null = null;
      if (copy.coverImageId) {
        const img = await ctx.db.get(copy.coverImageId);
        if (img && (img.moderationStatus ?? "approved") === "approved") {
          coverUrl = await ctx.storage.getUrl(img.fileId);
        }
      }
      if (!coverUrl && puzzle?.image) {
        coverUrl = await ctx.storage.getUrl(puzzle.image);
      }

      results.push(toOwnedCopyView(copy, puzzle, { coverUrl }));
    }

    return results;
  },
});

import type { OwnedCopyView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { canViewCopy } from "../library/canViewCopy";
import { toOwnedCopyView } from "../library/mappers";
import { resolveCopyCoverUrl } from "../library/resolveCoverUrl";
import { canSeeProfileContent } from "./privacy";

// Social read: the curated, ordered set of owned copies a member has featured on their profile
// shelf. Auth-gated. Returns them in the stored order and skips any entry that no longer exists or
// is no longer owned by `userId` (defensive; ownership could have changed since curation).
//
// SECURITY: the shelf is profile content, so a viewer without the profile unlock
// (canSeeProfileContent: self, public profile or mutual follower, never across a block) gets [];
// otherwise a locked viewer could probe member ids to learn who owns a copy they can open. A
// NON-owner viewer then sees only copies they may actually reach (canViewCopy: owner public + open,
// or circle-shared) and never the owner-only fields (notes / acquisition provenance), which the
// mapper's includeOwnerOnly default withholds. The OWNER sees their full curated shelf with all
// owner-only fields. Returns [] when the member has no profile or has not curated their shelf
// (caller falls back to recent-6).
export const featuredShelf = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<OwnedCopyView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const isOwner = viewerId === args.userId;
    if (!(await canSeeProfileContent(ctx, viewerId, args.userId))) return [];

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
      // Reachability gate (identical to Browse / copy-detail): a non-owner only sees copies they
      // may actually view. The owner always passes this via canViewCopy's owner short-circuit.
      if (!(await canViewCopy(ctx, viewerId, copy))) continue;

      const puzzle = await ctx.db.get(copy.puzzleId);

      // The shelf draws covers as small plank textures: the shared, gated, thumbnail-sized cover.
      const coverUrl = await resolveCopyCoverUrl(ctx, copy, puzzle);

      results.push(
        toOwnedCopyView(copy, puzzle, { coverUrl, includeOwnerOnly: isOwner }),
      );
    }

    return results;
  },
});

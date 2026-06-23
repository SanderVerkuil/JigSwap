import type { OwnedCopyView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { canViewCopy } from "./canViewCopy";
import { toOwnedCopyView } from "./mappers";
import { resolveCopyCoverUrl } from "./resolveCoverUrl";

const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

// Library read: a member's owned copies (optionally only the available ones), each joined to its
// Catalog puzzle. Auth-gated. The OWNER sees everything (both available + private copies, with all
// owner-only fields). A NON-owner only sees available, non-private copies, with owner-only fields
// (acquisitionPrice/acquisitionSource/notes) stripped by the mapper's `includeOwnerOnly` default —
// `includeUnavailable` is ignored for non-owners. Filtering, the newest-first ordering, and the
// join are preserved from legacy puzzles.getOwnedPuzzlesByOwner; rows map to typed copy DTOs.
export const getOwnedPuzzlesByOwner = query({
  args: {
    ownerId: v.id("users"),
    includeUnavailable: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<OwnedCopyView[]> => {
    const viewerId = (await requireMember(ctx)) as unknown as Id<"users">;
    const isOwner = viewerId === args.ownerId;

    let ownedPuzzles = await ctx.db
      .query("ownedPuzzles")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();

    if (!isOwner) {
      // A non-owner only sees copies that pass THE canonical copy-reachability gate (canViewCopy),
      // exactly as Browse/getCopyInstanceView do — `includeUnavailable` is ignored. The previous
      // ad-hoc filter checked only the per-copy `visibility` + isOpen axes, NOT the owner's PROFILE
      // visibility, so available copies of a member with a PRIVATE profile were still enumerated to
      // any authenticated viewer. canViewCopy folds in owner-public AND circle-shared reachability,
      // closing that leak and keeping this read consistent with the rest of the library.
      const visible = await Promise.all(
        ownedPuzzles.map((copy) => canViewCopy(ctx, viewerId, copy)),
      );
      ownedPuzzles = ownedPuzzles.filter((_, i) => visible[i]);
    } else if (!args.includeUnavailable) {
      ownedPuzzles = ownedPuzzles.filter(isOpen);
    }

    const views = await Promise.all(
      ownedPuzzles.map(async (copy) => {
        const puzzle = await ctx.db.get(copy.puzzleId);
        return toOwnedCopyView(copy, puzzle, {
          coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
          includeOwnerOnly: isOwner,
        });
      }),
    );

    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});

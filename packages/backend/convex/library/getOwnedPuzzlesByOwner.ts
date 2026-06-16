import type { OwnedCopyView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toOwnedCopyView } from "./mappers";

const isOpen = (copy: Doc<"ownedPuzzles">): boolean =>
  copy.availability.forTrade ||
  copy.availability.forSale ||
  copy.availability.forLend;

// Owner-only fields that must never surface on a NON-owner's view of a copy (price, provenance and
// private notes are personal to the owner). Strip them off the row before it reaches the mapper.
const stripOwnerOnly = (copy: Doc<"ownedPuzzles">): Doc<"ownedPuzzles"> => {
  const { salePrice, acquisitionPrice, acquisitionSource, notes, ...rest } =
    copy;
  void salePrice;
  void acquisitionPrice;
  void acquisitionSource;
  void notes;
  return rest as Doc<"ownedPuzzles">;
};

// Library read: a member's owned copies (optionally only the available ones), each joined to its
// Catalog puzzle. Auth-gated. The OWNER sees everything (both available + private copies, with all
// owner-only fields). A NON-owner only sees available, non-private copies, with owner-only fields
// (salePrice/acquisitionPrice/acquisitionSource/notes) stripped — `includeUnavailable` is ignored
// for non-owners. Filtering, the newest-first ordering, and the join are preserved from legacy
// puzzles.getOwnedPuzzlesByOwner; rows map to typed copy DTOs.
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
      // A non-owner only ever sees available, non-private copies — `includeUnavailable` is ignored.
      ownedPuzzles = ownedPuzzles.filter(
        (i) => i.visibility !== "private" && isOpen(i),
      );
    } else if (!args.includeUnavailable) {
      ownedPuzzles = ownedPuzzles.filter(isOpen);
    }

    const views = await Promise.all(
      ownedPuzzles.map(async (rawCopy) => {
        const copy = isOwner ? rawCopy : stripOwnerOnly(rawCopy);
        const puzzle = await ctx.db.get(copy.puzzleId);
        // Resolve the card cover: the copy's chosen-and-APPROVED cover photo if set, otherwise the
        // puzzle's global box art, else null (the card falls back to its placeholder). Pending or
        // rejected cover photos do not surface — only approved (absent status = legacy = approved).
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
        return toOwnedCopyView(copy, puzzle, { coverUrl });
      }),
    );

    return views.sort((a, b) => b.createdAt - a.createdAt);
  },
});

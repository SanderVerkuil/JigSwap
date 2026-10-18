import type { CollectionDetailView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { canViewCopy } from "./canViewCopy";
import { toCollectionDetailView, toOwnedCopyView } from "./mappers";
import { resolveCopyCoverUrl } from "./resolveCoverUrl";

// Library read: a collection with its member copies resolved (each carrying its addedAt and joined
// Catalog puzzle). Returns null on a missing collection, and drops members whose copy was deleted —
// both preserved from legacy collections.getCollectionById; the result maps to a typed detail DTO.
export const getCollectionById = query({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, args): Promise<CollectionDetailView | null> => {
    const actingMember = (await requireMember(ctx)) as unknown as Id<"users">;

    const collection = await ctx.db.get(args.collectionId);
    if (!collection) return null;

    // Visibility ACL: only the owner may read a non-public collection.
    if (
      collection.userId !== actingMember &&
      collection.visibility !== "public"
    ) {
      return null;
    }

    // The collection's own owner-only field (personalNotes) surfaces only to the collection owner.
    const isOwner = collection.userId === actingMember;

    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_collection", (q) =>
        q.eq("collectionId", args.collectionId),
      )
      .collect();

    const puzzles = await Promise.all(
      members.map(async (member) => {
        const copy = member.ownedPuzzleId
          ? await ctx.db.get(member.ownedPuzzleId)
          : null;
        if (!copy) return null;
        // A collection is a shelf of its owner's OWN copies (adding requires owning both). A member
        // row for a copy that has since changed hands is stale — e.g. left behind by a transfer
        // before memberships were withdrawn on CopyOwnershipTransferred — and is dropped, so the
        // previous owner's collection never lists the new owner's copy (no backfill needed).
        if (copy.ownerId !== collection.userId) return null;
        // Per-copy reachability gate: a non-owner viewing a public collection must NOT see member
        // copies that fail THE canonical copy-reachability gate (private/closed copies the owner
        // added), exactly as every sibling copy-read (getOwnedPuzzlesByOwner, getCopyInstanceView,
        // featuredShelf, listPuzzleComments, ...) does. The copy's owner sees it (canViewCopy
        // short-circuits on ownership).
        const viewerOwnsCopy = copy.ownerId === actingMember;
        if (!viewerOwnsCopy && !(await canViewCopy(ctx, actingMember, copy))) {
          return null;
        }
        const puzzle = await ctx.db.get(copy.puzzleId);
        return toOwnedCopyView(copy, puzzle, {
          addedAt: member.addedAt,
          // Owner-only copy fields (notes/acquisition provenance) are the COPY owner's, decided per
          // copy — never from who owns the collection.
          includeOwnerOnly: viewerOwnsCopy,
          coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
        });
      }),
    );

    return toCollectionDetailView(
      collection,
      puzzles.filter((p) => p !== null),
      { includeOwnerOnly: isOwner },
    );
  },
});

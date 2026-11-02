import type { CollectionDetailView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { canSeeProfileContent } from "../social/privacy";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "./canViewCopy";
import { toCollectionDetailView, toOwnedCopyView } from "./mappers";
import { resolveCopyCoverFields } from "./resolveCoverUrl";

// The newest members one read resolves. A member costs up to five index ranges (the copy, its puzzle
// and its cover), plus the copy gate's on another member's copy, and Convex allows 4,096 per function.
export const COLLECTION_ROWS_MAX = 500;

// Library read: a collection with its member copies resolved (each carrying its addedAt and joined
// Catalog puzzle). Returns null on a missing collection, and drops members whose copy was deleted —
// both preserved from legacy collections.getCollectionById; the result maps to a typed detail DTO.
// Past COLLECTION_ROWS_MAX members it covers the newest and says so (`hasMorePuzzles`), instead of
// failing the page.
export const getCollectionById = query({
  args: { collectionId: v.id("collections") },
  handler: async (ctx, args): Promise<CollectionDetailView | null> => {
    const actingMember = (await requireMember(ctx)) as unknown as Id<"users">;

    const collection = await ctx.db.get(args.collectionId);
    if (!collection) return null;

    // Visibility ACL: only the owner may read a non-public collection. Another member's public
    // collection is profile content (SEC-37): shown only when canSeeProfileContent holds (public
    // profile or mutual followers, never across a block either way), as getUserCollections lists.
    if (collection.userId !== actingMember) {
      if (collection.visibility !== "public") return null;
      if (!(await canSeeProfileContent(ctx, actingMember, collection.userId))) {
        return null;
      }
    }

    // The collection's own owner-only field (personalNotes) surfaces only to the collection owner.
    const isOwner = collection.userId === actingMember;

    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_collection", (q) =>
        q.eq("collectionId", args.collectionId),
      )
      .order("desc")
      .take(COLLECTION_ROWS_MAX + 1);
    const hasMorePuzzles = members.length > COLLECTION_ROWS_MAX;

    const entries = await Promise.all(
      members
        .slice(0, COLLECTION_ROWS_MAX)
        .reverse()
        .map(async (member) => {
          const copy = member.ownedPuzzleId
            ? await ctx.db.get(member.ownedPuzzleId)
            : null;
          if (!copy) return null;
          // A collection is a shelf of its owner's OWN copies (adding requires owning both). A member
          // row for a copy that has since changed hands is stale — e.g. left behind by a transfer
          // before memberships were withdrawn on CopyOwnershipTransferred — and is dropped, so the
          // previous owner's collection never lists the new owner's copy (no backfill needed).
          if (copy.ownerId !== collection.userId) return null;
          return { member, copy };
        }),
    );

    // Per-copy reachability gate: a non-owner viewing a public collection must NOT see member
    // copies that fail THE canonical copy-reachability gate (private/closed copies the owner
    // added), exactly as every sibling copy-read (getOwnedPuzzlesByOwner, getCopyInstanceView,
    // featuredShelf, listPuzzleComments, ...) does. The copy's owner sees it (short-circuit below).
    // One context for the whole collection, built only when a non-owned copy needs it; sequential,
    // because the context's memos aren't safe to share across a Promise.all.
    let context: CopyViewContext | null = null;
    const visible = [];
    for (const entry of entries) {
      if (!entry) continue;
      if (entry.copy.ownerId !== actingMember) {
        context ??= await buildCopyViewContext(ctx, actingMember);
        if (!(await canViewCopyWithContext(ctx, entry.copy, context))) continue;
      }
      visible.push(entry);
    }

    const puzzles = await Promise.all(
      visible.map(async ({ member, copy }) => {
        const viewerOwnsCopy = copy.ownerId === actingMember;
        const puzzle = await ctx.db.get(copy.puzzleId);
        return toOwnedCopyView(copy, puzzle, {
          addedAt: member.addedAt,
          // Owner-only copy fields (notes/acquisition provenance) are the COPY owner's, decided per
          // copy — never from who owns the collection.
          includeOwnerOnly: viewerOwnsCopy,
          ...(await resolveCopyCoverFields(ctx, copy, puzzle)),
        });
      }),
    );

    return toCollectionDetailView(collection, puzzles, hasMorePuzzles, {
      includeOwnerOnly: isOwner,
    });
  },
});

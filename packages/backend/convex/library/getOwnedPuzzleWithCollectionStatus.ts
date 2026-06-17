import type {
  OwnedCopyCollectionStatusView,
  OwnedCopyDetailView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import {
  toOwnedCopyCompletionView,
  toOwnedCopyImageView,
  toOwnedCopyOwnerView,
  toOwnedCopyPuzzleView,
} from "./mappers";

// Library read: a single owned copy enriched with its image rows, owner, the acting member's
// collection status, and completion history. Returns null (rather than throwing) on missing
// auth/user/copy/puzzle, identical to legacy puzzles.getOwnedPuzzleWithCollectionStatus; the result
// maps to a typed detail DTO.
export const getOwnedPuzzleWithCollectionStatus = query({
  args: { ownedPuzzleId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<OwnedCopyDetailView | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return null;

    const ownedPuzzle = await ctx.db.get(args.ownedPuzzleId);
    if (!ownedPuzzle) return null;

    // Owner-only management view: collection status and completion history are computed for the
    // ACTING member, and the result exposes financials (acquisition/sale price), private notes, and
    // unmoderated photos. A non-owner gets null; the public copy-detail route uses the gated
    // getCopyInstanceView instead.
    if (ownedPuzzle.ownerId !== user._id) return null;

    const puzzle = await ctx.db.get(ownedPuzzle.puzzleId);
    if (!puzzle) return null;

    const owner = await ctx.db.get(ownedPuzzle.ownerId);

    // Collection status of THIS specific copy: find a collectionMembers row for the copy whose
    // collection belongs to the acting member. `by_user` is non-unique, so the user's collection ids
    // are collected into a set and the copy's membership rows are matched against it. (A bare
    // `.unique()` on `by_user` would throw for any member with >=2 collections, and a non-null
    // collection never proved the copy itself was a member.)
    const userCollectionIds = new Set(
      (
        await ctx.db
          .query("collections")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect()
      ).map((c) => c._id),
    );
    const memberships = await ctx.db
      .query("collectionMembers")
      .withIndex("by_owned_puzzle", (q) =>
        q.eq("ownedPuzzleId", args.ownedPuzzleId),
      )
      .collect();
    const membership = memberships.find((m) =>
      userCollectionIds.has(m.collectionId),
    );
    const collection = membership
      ? await ctx.db.get(membership.collectionId)
      : null;

    const completions = await ctx.db
      .query("completions")
      .withIndex("by_user_owned_puzzle", (q) =>
        q.eq("userId", user._id).eq("ownedPuzzleId", args.ownedPuzzleId),
      )
      .filter((q) => q.eq(q.field("isCompleted"), true))
      .order("desc")
      .collect();

    const images = await ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_owned_puzzle", (q) =>
        q.eq("ownedPuzzleId", args.ownedPuzzleId),
      )
      .collect();

    const collectionStatus: OwnedCopyCollectionStatusView = collection
      ? {
          isInCollection: true,
          visibility: collection.visibility,
          personalNotes: collection.personalNotes,
        }
      : { isInCollection: false };

    return {
      _id: ownedPuzzle._id,
      _creationTime: ownedPuzzle._creationTime,
      aggregateId: ownedPuzzle.aggregateId,
      puzzleId: ownedPuzzle.puzzleId,
      puzzleDefinitionId: ownedPuzzle.puzzleDefinitionId,
      ownerId: ownedPuzzle.ownerId,
      condition: ownedPuzzle.condition,
      missingPiecesCount: ownedPuzzle.missingPiecesCount,
      notes: ownedPuzzle.notes,
      availability: ownedPuzzle.availability,
      visibility: ownedPuzzle.visibility,
      salePrice: ownedPuzzle.salePrice,
      acquisitionDate: ownedPuzzle.acquisitionDate,
      acquisitionSource: ownedPuzzle.acquisitionSource,
      acquisitionPrice: ownedPuzzle.acquisitionPrice,
      snapshot: ownedPuzzle.snapshot,
      createdAt: ownedPuzzle.createdAt,
      updatedAt: ownedPuzzle.updatedAt,
      puzzle: toOwnedCopyPuzzleView(puzzle),
      images: images.map(toOwnedCopyImageView),
      owner: owner ? toOwnedCopyOwnerView(owner) : null,
      collectionStatus,
      completionHistory: completions.map(toOwnedCopyCompletionView),
    };
  },
});

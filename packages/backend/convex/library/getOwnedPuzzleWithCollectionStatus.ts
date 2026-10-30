import type {
  OwnedCopyCollectionStatusView,
  OwnedCopyDetailView,
} from "@jigswap/contracts";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalActingMember } from "../identity/optionalActingMember";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import { effectiveCopyVisibility } from "./copyVisibility";
import {
  toCopyPuzzleView,
  toCopySnapshotView,
  toOwnedCopyCompletionView,
  toOwnedCopyImageView,
  toOwnedCopyOwnerView,
} from "./mappers";

// Library read: a single owned copy enriched with its image rows, owner, the acting member's
// collection status, and completion history. Returns null (rather than throwing) on missing
// auth/user/copy/puzzle and for a deactivated caller, as legacy
// puzzles.getOwnedPuzzleWithCollectionStatus did; the result maps to a typed detail DTO.
export const getOwnedPuzzleWithCollectionStatus = query({
  args: { ownedPuzzleId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<OwnedCopyDetailView | null> => {
    const me = await optionalActingMember(ctx);
    if (!me) return null;

    const ownedPuzzle = await ctx.db.get(args.ownedPuzzleId);
    if (!ownedPuzzle) return null;

    // Owner-only management view: collection status and completion history are computed for the
    // ACTING member, and the result exposes financials (acquisition/sale price), private notes, and
    // unmoderated photos. A non-owner gets null; the public copy-detail route uses the gated
    // getCopyInstanceView instead.
    if (ownedPuzzle.ownerId !== me) return null;

    // The definition's catalogue facts follow the copy views' rule (toCopyPuzzleView): the owner
    // gets a pending or rejected definition's text only if they submitted it.
    const puzzle = toCopyPuzzleView(
      ownedPuzzle,
      await ctx.db.get(ownedPuzzle.puzzleId),
      { includeOwnerOnly: true },
    );
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
          .withIndex("by_user", (q) => q.eq("userId", me))
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
        q.eq("userId", me).eq("ownedPuzzleId", args.ownedPuzzleId),
      )
      .filter((q) => q.eq(q.field("isCompleted"), true))
      .order("desc")
      .collect();

    // A quarantined photo (CSAM hash match) is never exposed, not even its storage id.
    const images = (
      await ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_owned_puzzle", (q) =>
          q.eq("ownedPuzzleId", args.ownedPuzzleId),
        )
        .collect()
    ).filter((img) => img.moderationStatus !== "quarantined");
    // Each photo goes out as a URL, never its storage id (SEC-01), and only once it is approved
    // with its hash check passed (the cover rule in resolveCoverUrl); otherwise `url` is null.
    const imageViews = await Promise.all(
      images.map(async (img) =>
        toOwnedCopyImageView(
          img,
          (img.moderationStatus ?? "approved") === "approved" &&
            isHashCleared(img)
            ? await ctx.storage.getUrl(img.fileId)
            : null,
        ),
      ),
    );

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
      visibility: effectiveCopyVisibility(ownedPuzzle),
      salePrice: ownedPuzzle.salePrice,
      acquisitionDate: ownedPuzzle.acquisitionDate,
      acquisitionSource: ownedPuzzle.acquisitionSource,
      acquisitionPrice: ownedPuzzle.acquisitionPrice,
      snapshot: toCopySnapshotView(ownedPuzzle.snapshot),
      createdAt: ownedPuzzle.createdAt,
      updatedAt: ownedPuzzle.updatedAt,
      puzzle,
      images: imageViews,
      owner: owner ? toOwnedCopyOwnerView(owner) : null,
      collectionStatus,
      completionHistory: completions.map(toOwnedCopyCompletionView),
    };
  },
});

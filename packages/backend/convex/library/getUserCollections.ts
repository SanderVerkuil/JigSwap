import type { CollectionView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { canSeeProfileContent } from "../social/privacy";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "./canViewCopy";
import { toCollectionView, toOwnedCopyView } from "./mappers";
import { resolveCopyCoverUrl } from "./resolveCoverUrl";

// How many member rows one read checks against their copies, across all the collections it lists.
// A check costs an index range, and through the copy gate on another member's copy a few more, and
// Convex allows 4,096 per function. Past it: your own collection counts the rest unchecked (a stale
// row is rare and only makes a number one too high), another member's stops counting, so a copy it
// may not show is never counted and its number is then a lower bound.
export const COLLECTION_MEMBER_VERIFICATIONS = { own: 3000, other: 500 };

// The boxes each collection's shelf shows on the Collections page: its newest copies the viewer may
// see, joined to their puzzle and cover. A box costs about as much as a card (a few ranges and four
// URLs), so one read joins at most COLLECTION_SHELF_BOXES_MAX of them, for the collections in page
// order; past it a collection lists with an empty shelf and its count.
export const COLLECTION_SHELF_SIZE = 6;
export const COLLECTION_SHELF_BOXES_MAX = 60;

// Library read: a member's collections with their derived member counts. Auth gating, the count
// derivation, and the default-first/name ordering are preserved from legacy
// collections.getUserCollections; rows map to typed collection DTOs.
// Another member's collections are profile content (SEC-37): only their PUBLIC collections, and
// only when canSeeProfileContent holds (public profile or mutual followers, never across a block
// either way). There is deliberately no platform-wide "every public collection" mode.
export const getUserCollections = query({
  args: {
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<CollectionView[]> => {
    // An unknown or deactivated caller is refused (requireMember).
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    const targetUserId = args.userId || me;
    const isOwner = targetUserId === me;
    if (!isOwner && !(await canSeeProfileContent(ctx, me, targetUserId))) {
      return [];
    }

    let collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", targetUserId))
      .collect();

    // Visibility ACL: another member's private collections (names, descriptions, personalNotes,
    // wished definitions) must never leak — only the owner sees their own private collections.
    if (!isOwner) {
      collections = collections.filter((c) => c.visibility === "public");
    }

    // A collection counts only its owner's OWN copies (the rule getCollectionById lists by: a member
    // row for a copy that changed hands is stale). Another member's collection further counts only
    // the copies getCollectionById would show this viewer (THE copy gate — so a private copy in a
    // public collection is neither listed nor counted). One db.get per member row, up to
    // COLLECTION_MEMBER_VERIFICATIONS. Sequential: the copy-view context's memos aren't safe to share
    // across a Promise.all. The copies that pass are the only ones its shelf may show.
    let context: CopyViewContext | null = null;
    let verified = 0;
    const listed: Array<{
      view: CollectionView;
      shown: Doc<"ownedPuzzles">[];
    }> = [];
    for (const collection of collections) {
      const members = await ctx.db
        .query("collectionMembers")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect();
      const viewerOwnsCollection = collection.userId === me;
      if (!viewerOwnsCollection) {
        context ??= await buildCopyViewContext(ctx, me);
      }
      const budget = viewerOwnsCollection
        ? COLLECTION_MEMBER_VERIFICATIONS.own
        : COLLECTION_MEMBER_VERIFICATIONS.other;
      let count = 0;
      const shown: Doc<"ownedPuzzles">[] = [];
      for (const member of members) {
        if (verified >= budget) {
          if (viewerOwnsCollection) count += 1;
          continue;
        }
        verified += 1;
        const copy = member.ownedPuzzleId
          ? await ctx.db.get(member.ownedPuzzleId)
          : null;
        if (!copy || copy.ownerId !== collection.userId) continue;
        if (
          context &&
          !viewerOwnsCollection &&
          !(await canViewCopyWithContext(ctx, copy, context))
        ) {
          continue;
        }
        count += 1;
        shown.push(copy);
      }
      listed.push({
        view: toCollectionView(collection, count, {
          // personalNotes is owner-only: surface it only on the acting member's OWN collections.
          includeOwnerOnly: collection.userId === me,
        }),
        shown,
      });
    }

    listed.sort(({ view: a }, { view: b }) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });

    // Each shelf, in page order: the newest members first (by_collection ends in _creationTime),
    // with no owner-only copy fields whoever looks.
    let boxes = 0;
    for (const entry of listed) {
      const take = Math.min(
        COLLECTION_SHELF_SIZE,
        COLLECTION_SHELF_BOXES_MAX - boxes,
      );
      // (slice(-0) would be every copy.)
      const newest = take > 0 ? entry.shown.slice(-take).reverse() : [];
      boxes += newest.length;
      entry.view.shelf = await Promise.all(
        newest.map(async (copy) => {
          const puzzle = await ctx.db.get(copy.puzzleId);
          return toOwnedCopyView(copy, puzzle, {
            coverUrl: await resolveCopyCoverUrl(ctx, copy, puzzle),
            includeOwnerOnly: false,
          });
        }),
      );
    }

    return listed.map(({ view }) => view);
  },
});

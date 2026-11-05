import type { CollectionView } from "@jigswap/contracts";
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
import { toCollectionView } from "./mappers";

// How many member rows one read checks against their copies, across all the collections it lists.
// A check costs an index range, and through the copy gate on another member's copy a few more, and
// Convex allows 4,096 per function. Past it: your own collection counts the rest unchecked (a stale
// row is rare and only makes a number one too high), another member's stops counting, so a copy it
// may not show is never counted and its number is then a lower bound.
export const COLLECTION_MEMBER_VERIFICATIONS = { own: 3000, other: 500 };

// Library read (collections are a Personal Library concern): a member's collections with their
// derived member counts. Auth gating, the count derivation, and the default-first/name ordering are
// preserved from legacy collections.getUserCollections; rows map to typed collection DTOs.
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
    // across a Promise.all.
    let context: CopyViewContext | null = null;
    let verified = 0;
    const views = [];
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
      }
      views.push(
        toCollectionView(collection, count, {
          // personalNotes is owner-only: surface it only on the acting member's OWN collections.
          includeOwnerOnly: collection.userId === me,
        }),
      );
    }

    return views.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

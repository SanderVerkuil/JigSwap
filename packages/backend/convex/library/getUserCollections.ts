import type { CollectionView } from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import {
  buildCopyViewContext,
  canViewCopyWithContext,
  type CopyViewContext,
} from "./canViewCopy";
import { toCollectionView } from "./mappers";

// Library read (collections are a Personal Library concern): a member's collections with their
// derived member counts. Auth gating, the optional public-collection inclusion for OTHER members,
// the count derivation, and the default-first/name ordering are preserved from legacy
// collections.getUserCollections; rows map to typed collection DTOs.
export const getUserCollections = query({
  args: {
    userId: v.optional(v.id("users")),
    includePublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<CollectionView[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const currentUser = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!currentUser) throw new ConvexError("User not found");

    const targetUserId = args.userId || currentUser._id;
    const isOwner = targetUserId === currentUser._id;

    let collections = await ctx.db
      .query("collections")
      .withIndex("by_user", (q) => q.eq("userId", targetUserId))
      .collect();

    // Visibility ACL: another member's private collections (names, descriptions, personalNotes,
    // wished definitions) must never leak — only the owner sees their own private collections.
    if (!isOwner) {
      collections = collections.filter((c) => c.visibility === "public");
    }

    if (args.includePublic && !isOwner) {
      const publicCollections = await ctx.db
        .query("collections")
        .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
        .collect();
      // De-duplicate by `_id` (keep first occurrence): the target's public collections were already
      // fetched above and ALSO appear in this platform-wide public set, so a plain concat would
      // surface each of the target's public collections twice.
      const merged = [...collections, ...publicCollections];
      const seen = new Set<string>();
      collections = merged.filter((c) => {
        const id = c._id as unknown as string;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    // Another member's collection counts only the member copies getCollectionById would show this
    // viewer (THE copy gate — so a private copy in a public collection is neither listed nor
    // counted); the viewer's own collections keep the raw member count. Sequential: the copy-view
    // context's memos aren't safe to share across a Promise.all.
    let context: CopyViewContext | null = null;
    const views = [];
    for (const collection of collections) {
      const members = await ctx.db
        .query("collectionMembers")
        .withIndex("by_collection", (q) => q.eq("collectionId", collection._id))
        .collect();
      let count = members.length;
      if (collection.userId !== currentUser._id) {
        context ??= await buildCopyViewContext(
          ctx,
          currentUser._id as Id<"users">,
        );
        count = 0;
        for (const member of members) {
          const copy = member.ownedPuzzleId
            ? await ctx.db.get(member.ownedPuzzleId)
            : null;
          if (copy && (await canViewCopyWithContext(ctx, copy, context))) {
            count += 1;
          }
        }
      }
      views.push(
        toCollectionView(collection, count, {
          // personalNotes is owner-only: surface it only on the acting member's OWN collections
          // (the public-collection set may include OTHER members' collections under includePublic).
          includeOwnerOnly: collection.userId === currentUser._id,
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

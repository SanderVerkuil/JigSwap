import type { CollectionView } from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
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
      collections = [...collections, ...publicCollections];
    }

    const views = await Promise.all(
      collections.map(async (collection) => {
        const members = await ctx.db
          .query("collectionMembers")
          .withIndex("by_collection", (q) =>
            q.eq("collectionId", collection._id),
          )
          .collect();
        return toCollectionView(collection, members.length);
      }),
    );

    return views.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

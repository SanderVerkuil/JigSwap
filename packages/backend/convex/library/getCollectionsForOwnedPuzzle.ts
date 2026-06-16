import type { CollectionMembershipView } from "@jigswap/contracts";
import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";
import { toCollectionMembershipView } from "./mappers";

// Library read: the acting member's collections that contain a given copy. Auth gating and the
// owner-scoped filter (only the member's OWN collections) are preserved from legacy
// collections.getCollectionsForOwnedPuzzle; rows map to typed bare-collection DTOs.
export const getCollectionsForOwnedPuzzle = query({
  args: { ownedPuzzleId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<CollectionMembershipView[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) throw new ConvexError("User not found");

    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_owned_puzzle", (q) =>
        q.eq("ownedPuzzleId", args.ownedPuzzleId),
      )
      .collect();

    const collections = await Promise.all(
      members.map(async (member) => {
        const collection = await ctx.db.get(member.collectionId);
        return collection && collection.userId === user._id ? collection : null;
      }),
    );

    // Every collection here belongs to the acting member (filtered above), so the viewer is the
    // owner — surface their own personalNotes.
    return collections
      .filter((c) => c !== null)
      .map((c) => toCollectionMembershipView(c, { includeOwnerOnly: true }));
  },
});

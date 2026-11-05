import type { CollectionMembershipView } from "@jigswap/contracts";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { toCollectionMembershipView } from "./mappers";

// Library read: the acting member's collections that contain a given copy. Auth gating (an
// unknown or deactivated caller is refused by requireMember) and the owner-scoped filter (only
// the member's OWN collections) are preserved from legacy collections.getCollectionsForOwnedPuzzle;
// rows map to typed bare-collection DTOs.
export const getCollectionsForOwnedPuzzle = query({
  args: { ownedPuzzleId: v.id("ownedPuzzles") },
  handler: async (ctx, args): Promise<CollectionMembershipView[]> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;

    // Only the copy's owner has it on their shelves: a stale member row (the copy changed hands)
    // must not tell the previous owner it is still in their collection.
    const copy = await ctx.db.get(args.ownedPuzzleId);
    if (!copy || copy.ownerId !== me) return [];

    const members = await ctx.db
      .query("collectionMembers")
      .withIndex("by_owned_puzzle", (q) =>
        q.eq("ownedPuzzleId", args.ownedPuzzleId),
      )
      .collect();

    const collections = await Promise.all(
      members.map(async (member) => {
        const collection = await ctx.db.get(member.collectionId);
        return collection && collection.userId === me ? collection : null;
      }),
    );

    // Every collection here belongs to the acting member (filtered above), so the viewer is the
    // owner — surface their own personalNotes.
    return collections
      .filter((c) => c !== null)
      .map((c) => toCollectionMembershipView(c, { includeOwnerOnly: true }));
  },
});

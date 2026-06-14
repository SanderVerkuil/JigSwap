import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Composition root for attaching an uploaded photo to an owned copy, keyed by the copy's Convex id.
// Pairs with `generateUploadUrl`: the client uploads the blob, then calls this with the returned
// storageId. A plain Convex mutation that writes the `ownedPuzzleImages` read-model directly (the
// gallery in getCopyInstanceView reads the same table). Owner-only: only the copy's owner may add a
// photo to it.
export const addCopyPhoto = mutation({
  args: {
    copyId: v.id("ownedPuzzles"),
    fileId: v.id("_storage"),
    tag: v.optional(
      v.union(
        v.literal("box_front"),
        v.literal("box_back"),
        v.literal("pieces"),
        v.literal("completed"),
        v.literal("damage_detail"),
      ),
    ),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const copy = await ctx.db.get(args.copyId);
    if (!copy) throw new ConvexError("Copy not found");
    if (copy.ownerId !== memberId) {
      throw new ConvexError("Only the owner can add a photo to this copy");
    }

    const now = Date.now();
    await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: args.copyId,
      uploaderId: memberId,
      fileId: args.fileId,
      title: args.title,
      tag: args.tag,
      createdAt: now,
      updatedAt: now,
    });
  },
});

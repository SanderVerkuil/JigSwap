import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Owner-only removal of an uploaded copy photo: deletes the `ownedPuzzleImages` row AND its storage
// blob, and clears the copy's cover when this photo was the cover (so it falls back to the
// catalogue image). Keyed by the image id; the gallery (getCopyInstanceView) reads the same table,
// so Convex reactivity drops it from the UI. Mirrors addCopyPhoto's direct read-model write.
export const removeCopyPhoto = mutation({
  args: { imageId: v.id("ownedPuzzleImages") },
  handler: async (ctx, { imageId }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const image = await ctx.db.get(imageId);
    if (!image) throw new ConvexError("Photo not found");

    const copy = await ctx.db.get(image.ownedPuzzleId);
    if (!copy) throw new ConvexError("Copy not found");
    if (copy.ownerId !== memberId) {
      throw new ConvexError("Only the owner can remove a photo from this copy");
    }

    // Clear the cover if this photo was it, so getCopyInstanceView falls back to the global image.
    if (copy.coverImageId === imageId) {
      await ctx.db.patch(copy._id, { coverImageId: undefined });
    }

    await ctx.db.delete(imageId);
    // Best-effort: drop the stored blob so it doesn't orphan. The row is already gone either way.
    try {
      await ctx.storage.delete(image.fileId);
    } catch {
      // A lingering blob is harmless; nothing references it.
    }
  },
});

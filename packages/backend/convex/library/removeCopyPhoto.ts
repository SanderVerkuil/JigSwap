import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { canManageCopy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { isPreservedBlob } from "../lib/imageModeration/quarantine";

// Owner (or household manage member) removal of an uploaded copy photo: deletes the `ownedPuzzleImages` row AND its storage
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
    // Owner, or a household member the owner left at "manage" (co-owner).
    if (!(await canManageCopy(ctx, memberId, copy))) {
      throw new ConvexError("Only the owner can remove a photo from this copy");
    }

    // Clear the cover if this photo was it, so getCopyInstanceView falls back to the global image.
    if (copy.coverImageId === imageId) {
      await ctx.db.patch(copy._id, { coverImageId: undefined });
    }

    // A quarantined photo (CSAM hash match) is already invisible to its uploader; "removing" it
    // must neither destroy the preserved evidence nor reveal the quarantine, so it succeeds
    // silently without touching the row or the blob.
    if (image.moderationStatus === "quarantined") return;

    await ctx.db.delete(imageId);
    // Best-effort: drop the stored blob so it doesn't orphan. The row is already gone either way.
    // A blob preserved for a CSAM escalation (the same file re-uploaded) is never deleted.
    if (await isPreservedBlob(ctx, image.fileId)) return;
    try {
      await ctx.storage.delete(image.fileId);
    } catch {
      // A lingering blob is harmless; nothing references it.
    }
  },
});

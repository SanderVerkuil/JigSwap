import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { canManageCopy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { deleteRenditions } from "../lib/imageModeration/renditionsStore";
import { deleteBlobUnlessReferenced } from "../lib/storage/blobLifecycle";

// Removal of an uploaded copy photo by the copy's owner (or household manage member), or by the member who uploaded it:
// deletes the `ownedPuzzleImages` row AND its storage blob (unless another row still holds it), and clears the copy's cover
// when this photo was the cover (so it falls back to the catalogue image). Keyed by the image id; the gallery
// (getCopyInstanceView) reads the same table, so Convex reactivity drops it from the UI. Mirrors addCopyPhoto's direct
// read-model write.
export const removeCopyPhoto = mutation({
  args: { imageId: v.id("ownedPuzzleImages") },
  handler: async (ctx, { imageId }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const image = await ctx.db.get(imageId);
    if (!image) throw new ConvexError("Photo not found");

    const copy = await ctx.db.get(image.ownedPuzzleId);
    if (!copy) throw new ConvexError("Copy not found");
    // Owner, a household member the owner left at "manage" (co-owner), or the photo's uploader:
    // a member keeps the right to take down a photo they took after they lose the copy, e.g. the
    // previous owner once it changed hands (SEC-38). getCopyInstanceView's viewerMayRemove mirrors
    // this rule.
    if (
      image.uploaderId !== memberId &&
      !(await canManageCopy(ctx, memberId, copy))
    ) {
      throw new ConvexError(
        "Only the copy's owner or the photo's uploader can remove this photo",
      );
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
    await deleteRenditions(ctx, image.fileId);
    // Drop the stored blob so it doesn't orphan, unless anything else holds it: a CSAM escalation
    // preserves it, or a row written before the claim rule holds the same id, such as catalogue
    // box art (SEC-01).
    await deleteBlobUnlessReferenced(ctx, image.fileId);
  },
});

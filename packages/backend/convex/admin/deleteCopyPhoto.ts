import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteRenditions } from "../lib/imageModeration/renditionsStore";
import { deleteBlobUnlessReferenced } from "../lib/storage/blobLifecycle";

// Remove a copy photo for good: clear the copy's cover if this photo was it (mirrors
// removeCopyPhoto), then drop its renditions, the blob and the row. Shared by the moderation
// paths that remove a photo (confirmPhotoRemoval, decideReport); `copy` is the photo's copy,
// already loaded.
export const deleteCopyPhoto = async (
  ctx: MutationCtx,
  row: Doc<"ownedPuzzleImages">,
  copy: Doc<"ownedPuzzles"> | null,
): Promise<void> => {
  if (copy?.coverImageId === row._id) {
    await ctx.db.patch(copy._id, { coverImageId: undefined });
  }
  await deleteRenditions(ctx, row.fileId);
  // An upload refused by the pipeline's input guards (invalid_image) has no blob left. Anything
  // else that holds the blob keeps it: a CSAM escalation preserves it, or a row written before
  // the claim rule holds the same id, such as catalogue box art (SEC-01).
  await deleteBlobUnlessReferenced(ctx, row.fileId, { except: row._id });
  await ctx.db.delete(row._id);
};

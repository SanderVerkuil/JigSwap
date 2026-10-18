import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isPreservedBlob } from "../lib/imageModeration/quarantine";

// Remove a copy photo for good: clear the copy's cover if this photo was it (mirrors
// removeCopyPhoto), then drop the blob (unless it is missing or preserved for a CSAM escalation)
// and the row. Shared by the moderation paths that remove a
// photo (confirmPhotoRemoval, decideReport); `copy` is the photo's copy, already loaded.
export const deleteCopyPhoto = async (
  ctx: MutationCtx,
  row: Doc<"ownedPuzzleImages">,
  copy: Doc<"ownedPuzzles"> | null,
): Promise<void> => {
  if (copy?.coverImageId === row._id) {
    await ctx.db.patch(copy._id, { coverImageId: undefined });
  }
  // An upload refused by the pipeline's input guards (invalid_image) has no blob left, and a
  // blob preserved for a CSAM escalation is never deleted.
  if (
    (await ctx.db.system.get(row.fileId)) &&
    !(await isPreservedBlob(ctx, row.fileId))
  ) {
    await ctx.storage.delete(row.fileId);
  }
  await ctx.db.delete(row._id);
};

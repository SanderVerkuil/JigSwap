import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { isHashCleared } from "./hashCheckFields";

// Publication gate for box art (puzzles.image, a proposal's changes.image or baseline.image).
// Box art goes through the shared moderation pipeline (catalog/boxArtUploads), and its blob is
// listed in `boxArtUploads`. Like a copy photo's, no URL is issued for it until its CSAM hash
// check has passed, and, because box art is shown to everyone, not until it is "approved"
// either: pending, unscored, rejected and quarantined box art shows no image (the placeholder).
// A blob with no boxArtUploads row, or a row from before box art was moderated (no status, no
// hash-check fields), predates the gate and is served as before.
//
// EVERY read path that turns box art into a URL goes through `boxArtUrl`, never
// `ctx.storage.getUrl` on the image directly.

/** Whether a listed box-art upload may be served. */
export const isBoxArtServable = (
  row: Pick<
    Doc<"boxArtUploads">,
    "moderationStatus" | "hashCheckedAt" | "hashCheckPendingSince"
  >,
): boolean =>
  (row.moderationStatus ?? "approved") === "approved" && isHashCleared(row);

/** The URL of a box-art image, or null when there is none or it may not be served (yet). */
export const boxArtUrl = async (
  ctx: QueryCtx,
  image: Id<"_storage"> | string | null | undefined,
): Promise<string | null> => {
  if (!image) return null;
  const storageId = ctx.db.system.normalizeId("_storage", image);
  if (!storageId) return null;
  const row = await ctx.db
    .query("boxArtUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  if (row && !isBoxArtServable(row)) return null;
  return ctx.storage.getUrl(storageId);
};

import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { isPreservedBlob } from "./quarantine";

// Whether any table already references the blob (a copy photo, a completion photo, a message
// photo, a circle icon, a puzzle's box art or a proposed one, cleaned box art not yet used, a report's evidence
// copy) or a CSAM escalation preserves it: such a blob is never claimed and never deleted by an
// upload flow (message photo staging, the box-art strip). Known residual: legacy
// completion photos that predate their completionImages sidecar live only in the unindexable
// `completions.photos` array (and a proposal's `baseline.image` is the puzzle's current box art,
// already covered by puzzles.by_image).
export const isReferenced = async (
  ctx: QueryCtx,
  storageId: Id<"_storage">,
): Promise<boolean> => {
  const byFile = (
    table:
      | "ownedPuzzleImages"
      | "completionImages"
      | "messageAttachments"
      | "circleIcons",
  ) =>
    ctx.db
      .query(table)
      .withIndex("by_file", (q) => q.eq("fileId", storageId))
      .first();
  return (
    (await byFile("messageAttachments")) !== null ||
    (await byFile("ownedPuzzleImages")) !== null ||
    (await byFile("completionImages")) !== null ||
    (await byFile("circleIcons")) !== null ||
    (await ctx.db
      .query("puzzles")
      .withIndex("by_image", (q) => q.eq("image", storageId))
      .first()) !== null ||
    (await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_changes_image", (q) =>
        q.eq("changes.image", storageId as string),
      )
      .first()) !== null ||
    (await ctx.db
      .query("boxArtUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first()) !== null ||
    (await ctx.db
      .query("reports")
      .withIndex("by_evidence_file", (q) => q.eq("evidenceFileId", storageId))
      .first()) !== null ||
    (await isPreservedBlob(ctx, storageId))
  );
};

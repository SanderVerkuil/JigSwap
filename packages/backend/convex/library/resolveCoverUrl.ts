import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Canonical card-cover resolution for an owned copy, shared by every list read so cards look the
// same everywhere: the copy's chosen-and-APPROVED cover photo if set, otherwise the puzzle's global
// box art, else null (the card falls back to its placeholder). Pending/rejected cover photos do not
// surface — only approved (an absent status is legacy = approved). The catalogue `image` is a
// `_storage` id, so it MUST be resolved via `getUrl`.
export const resolveCopyCoverUrl = async (
  ctx: QueryCtx,
  copy: Doc<"ownedPuzzles">,
  puzzle: Doc<"puzzles"> | null,
): Promise<string | null> => {
  let coverUrl: string | null = null;
  if (copy.coverImageId) {
    const img = await ctx.db.get(copy.coverImageId);
    if (img && (img.moderationStatus ?? "approved") === "approved") {
      coverUrl = await ctx.storage.getUrl(img.fileId);
    }
  }
  if (!coverUrl && puzzle?.image) {
    coverUrl = await ctx.storage.getUrl(puzzle.image);
  }
  return coverUrl;
};

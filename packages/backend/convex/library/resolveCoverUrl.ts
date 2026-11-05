import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { boxArtImage } from "../lib/imageModeration/boxArtUrl";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import {
  renditionSources,
  thumbUrlOf,
  type ImageSources,
} from "../lib/imageModeration/imageSources";

// Canonical card-cover resolution for an owned copy, shared by every list read so cards look the
// same everywhere: the copy's chosen-and-APPROVED cover photo if set, otherwise the puzzle's global
// box art, else null (the card falls back to its placeholder). Pending/rejected cover photos do not
// surface — only approved (an absent status is legacy = approved) and hash-cleared. Either comes
// with its renditions (srcSet, thumbUrl) once they exist, read only AFTER its own gate: the cover
// photo's above, the box art's in boxArtImage (the catalogue `image` is a `_storage` id, so it
// MUST be resolved via that gate).
export const resolveCopyCover = async (
  ctx: QueryCtx,
  copy: Doc<"ownedPuzzles">,
  puzzle: Doc<"puzzles"> | null,
): Promise<ImageSources | null> => {
  let cover: ImageSources | null = null;
  if (copy.coverImageId) {
    const img = await ctx.db.get(copy.coverImageId);
    if (
      img &&
      (img.moderationStatus ?? "approved") === "approved" &&
      isHashCleared(img)
    ) {
      const url = await ctx.storage.getUrl(img.fileId);
      cover = url ? await renditionSources(ctx, img.fileId, url) : null;
    }
  }
  if (!cover && puzzle?.image) {
    cover = await boxArtImage(ctx, puzzle.image);
  }
  return cover;
};

/**
 * The copy's cover (resolveCopyCover) as one thumbnail-sized URL: every consumer of a lone cover
 * URL draws it small (chips, cover stacks, activity covers, list rows, shelf textures, dialogs),
 * so the box art's 480 px rendition once it exists, else the original. Null when it has none.
 */
export const resolveCopyCoverUrl = async (
  ctx: QueryCtx,
  copy: Doc<"ownedPuzzles">,
  puzzle: Doc<"puzzles"> | null,
): Promise<string | null> =>
  thumbUrlOf(await resolveCopyCover(ctx, copy, puzzle));

/**
 * The cover fields of a copy on a read that a card grid renders (toOwnedCopyView's `coverUrl` and
 * `coverSrcSet` opts): the thumbnail-sized URL (as resolveCopyCoverUrl, for the shelf textures and
 * dialogs that read `coverUrl` from the same response) plus, once its cover has renditions, the
 * srcSet the card picks a width from.
 */
export const resolveCopyCoverFields = async (
  ctx: QueryCtx,
  copy: Doc<"ownedPuzzles">,
  puzzle: Doc<"puzzles"> | null,
): Promise<{ coverUrl: string | null; coverSrcSet?: string }> => {
  const cover = await resolveCopyCover(ctx, copy, puzzle);
  return {
    coverUrl: thumbUrlOf(cover),
    ...(cover?.srcSet !== undefined && { coverSrcSet: cover.srcSet }),
  };
};

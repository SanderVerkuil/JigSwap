import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

// How a read model offers an image to the client: the original's URL, plus, once renditions
// exist for it (lib/imageModeration/renditions), a `srcSet` the browser picks a width from and a
// `thumbUrl` (the smallest rendition) for thumbnail-sized uses. Before the backfill, or for a
// source no wider than the smallest rendition, only `url` is set and callers show the original.
//
// URLs only: neither the source's nor a rendition's storage id ever leaves this module.

export type ImageSources = {
  url: string;
  /** The smallest rendition (480 px wide); absent when there is none. */
  thumbUrl?: string;
  /** `<url> <width>w` for each rendition and the original; absent when there are no renditions. */
  srcSet?: string;
};

/**
 * The URL for a thumbnail-sized use of an image (chips, list rows, shelf textures, dialogs): the
 * smallest rendition when there is one, else the original. Null when there is no image.
 */
export const thumbUrlOf = (image: ImageSources | null): string | null =>
  image ? (image.thumbUrl ?? image.url) : null;

/**
 * The renditions of a source blob as URLs, next to the source's own `url`. Only call it AFTER
 * the source's publication gate has passed (boxArtUrl's servableBoxArtId for box art): it does
 * not check whether the image may be shown.
 */
export const renditionSources = async (
  ctx: QueryCtx,
  sourceId: Id<"_storage">,
  url: string,
): Promise<ImageSources> => {
  const row = await ctx.db
    .query("imageRenditions")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .first();
  if (!row) return { url };
  const candidates: { url: string; width: number }[] = [];
  for (const slot of [row.small, row.medium]) {
    if (!slot) continue;
    // A slot whose blob is gone is left out rather than offered as a broken candidate.
    const slotUrl = await ctx.storage.getUrl(slot.fileId);
    if (slotUrl) candidates.push({ url: slotUrl, width: slot.width });
  }
  if (candidates.length === 0) return { url };
  return {
    url,
    thumbUrl: candidates[0].url,
    srcSet: [...candidates, { url, width: row.width }]
      .map((c) => `${c.url} ${c.width}w`)
      .join(", "),
  };
};

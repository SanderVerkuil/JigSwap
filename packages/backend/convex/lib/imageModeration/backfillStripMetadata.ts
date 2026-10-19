"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { logEvent } from "../logEvent";
import {
  tableValidator,
  totalsValidator,
  ZERO,
  type Totals,
} from "./backfillStripMetadataStore";
import { checkImageBytes, sniffImageFormat } from "./guards";
import { stripAndNormalise, type CleanImage } from "./normaliseImage";
import { findMetadata, stripImageMetadata } from "./stripMetadata";

// One-shot: strip the metadata (EXIF incl. GPS, XMP, IPTC, comments, PNG text chunks, WebP
// EXIF/XMP) from images stored before every upload path stripped it, and turn them upright:
// - "boxArt": puzzles.image. Box art was stored exactly as uploaded until catalog/sanitizeBoxArt
//   (and, until that turned the pixels upright, a JPEG kept an Orientation-only Exif block).
// - "proposals": puzzleChangeProposals.changes.image (a proposed new box art).
// - "copy" / "completion": ownedPuzzleImages / completionImages. The moderation pipeline always
//   re-encoded JPEG/PNG/GIF, but stored WebP as uploaded, and rows from before the pipeline were
//   never processed. Rows still pending (the pipeline owns them) or quarantined are skipped.
//
// Each image is downloaded and checked (findMetadata); one that carries metadata is stripped and
// turned upright (lib/imageModeration/normaliseImage: an Exif Orientation 2..8 is applied to the
// pixels and re-encoded, a turned WebP becoming JPEG or PNG; otherwise the bytes are stripped and
// the pixels untouched), stored as a new blob under its new content type, the row (and
// everything else pointing at the old blob: other definitions, proposals and their baselines, a
// completion's photos) switched to it, and the old blob deleted once nothing references it. An
// image that needs turning but is over the upload guards (lib/imageModeration/guards) or does
// not decode is still stripped (its metadata matters more than its rotation), just not turned.
// A clean, malformed or non-strippable (GIF) image is left alone and counted.
//
// Totals: `needsTurning` counts the images with metadata whose Exif held an Orientation of 2..8
// (in a dry run too); `turned` those stored upright. `needsTurning - turned` (after a real run)
// were stripped without turning.
//
// `dryRun` defaults to TRUE: it only counts. Pass `dryRun: false` to write. Paginated: `batchSize`
// rows per run (default 25); the action re-schedules itself with the next cursor and logs the
// running totals (event "imageModeration.backfillStripMetadata") on every page and the final
// totals with `done: true`. Re-runnable: a stripped image is clean on the next pass.

/** Strip and turn upright when the guards allow a decode; otherwise strip only. */
const clean = async (
  bytes: Uint8Array,
  format: CleanImage["format"],
): Promise<CleanImage | null> => {
  if (checkImageBytes(bytes).ok) {
    const normalised = await stripAndNormalise(bytes, format).catch(() => null);
    if (normalised) return normalised;
  }
  const stripped = stripImageMetadata(bytes, format);
  return (
    stripped && {
      bytes: stripped.bytes,
      format,
      mime: `image/${format}`,
      normalised: false,
    }
  );
};

export const backfillStripMetadata = internalAction({
  args: {
    table: tableValidator,
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    totals: v.optional(totalsValidator),
  },
  handler: async (ctx, args): Promise<Totals> => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.max(1, Math.min(100, args.batchSize ?? 25));
    const page = await ctx.runQuery(
      internal.lib.imageModeration.backfillStripMetadataStore.listPage,
      {
        table: args.table,
        paginationOpts: { numItems: batchSize, cursor: args.cursor ?? null },
      },
    );
    const batch: Totals = { ...ZERO, scanned: page.scanned };
    batch.skipped += page.scanned - page.items.length;

    for (const item of page.items) {
      const blob = await ctx.storage.get(item.fileId);
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
      const format = bytes ? sniffImageFormat(bytes) : null;
      if (!bytes || !format || format === "gif") {
        batch.skipped += 1;
        continue;
      }
      const left = findMetadata(bytes, format);
      if (left === null) {
        batch.skipped += 1;
        continue;
      }
      if (left.length === 0) {
        batch.clean += 1;
        continue;
      }
      batch.withMetadata += 1;
      if ((stripImageMetadata(bytes, format)?.orientation ?? 1) !== 1) {
        batch.needsTurning += 1;
      }
      if (dryRun) continue;

      const cleaned = await clean(bytes, format);
      // Defence in depth: what is about to be stored must carry no metadata at all.
      if (
        !cleaned ||
        findMetadata(cleaned.bytes, cleaned.format)?.length !== 0
      ) {
        continue;
      }
      const to = await ctx.storage.store(
        new Blob([cleaned.bytes as BlobPart], { type: cleaned.mime }),
      );
      const swapped = await ctx.runMutation(
        internal.lib.imageModeration.backfillStripMetadataStore.swapBlob,
        { table: args.table, id: item.id, from: item.fileId, to },
      );
      if (!swapped) {
        await ctx.storage.delete(to);
        continue;
      }
      batch.stripped += 1;
      if (cleaned.normalised) batch.turned += 1;
      const unreferenced = await ctx.runQuery(
        internal.lib.imageModeration.backfillStripMetadataStore.isUnreferenced,
        { storageId: item.fileId },
      );
      if (unreferenced) await ctx.storage.delete(item.fileId);
    }

    const prior = args.totals ?? ZERO;
    const totals: Totals = {
      scanned: prior.scanned + batch.scanned,
      withMetadata: prior.withMetadata + batch.withMetadata,
      stripped: prior.stripped + batch.stripped,
      needsTurning: prior.needsTurning + batch.needsTurning,
      turned: prior.turned + batch.turned,
      clean: prior.clean + batch.clean,
      skipped: prior.skipped + batch.skipped,
    };
    logEvent({
      event: "imageModeration.backfillStripMetadata",
      outcome: "success",
      table: args.table,
      dry_run: dryRun,
      done: page.isDone,
      ...totals,
    });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.imageModeration.backfillStripMetadata
          .backfillStripMetadata,
        {
          table: args.table,
          dryRun,
          cursor: page.continueCursor,
          batchSize,
          totals,
        },
      );
    }
    return batch;
  },
});

import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { logEvent } from "../logEvent";
import { isReferenced } from "./blobReferences";
import { sniffImageFormat } from "./guards";
import { findMetadata, stripImageMetadata } from "./stripMetadata";

// One-shot: strip the metadata (EXIF incl. GPS, XMP, IPTC, comments, PNG text chunks, WebP
// EXIF/XMP) from images stored before every upload path stripped it:
// - "boxArt": puzzles.image. Box art was stored exactly as uploaded until catalog/sanitizeBoxArt.
// - "proposals": puzzleChangeProposals.changes.image (a proposed new box art).
// - "copy" / "completion": ownedPuzzleImages / completionImages. The moderation pipeline always
//   re-encoded JPEG/PNG/GIF, but stored WebP as uploaded, and rows from before the pipeline were
//   never processed. Rows still pending (the pipeline owns them) or quarantined are skipped.
//
// Each image is downloaded and checked (findMetadata); one that carries metadata is stripped at
// byte level (the pixels are untouched, a JPEG keeps only its Orientation), stored as a new blob,
// the row (and everything else pointing at the old blob: other definitions, proposals and their
// baselines, a completion's photos) switched to it, and the old blob deleted once nothing
// references it. A clean, malformed or non-strippable (GIF) image is left alone and counted.
//
// `dryRun` defaults to TRUE: it only counts. Pass `dryRun: false` to write. Paginated: `batchSize`
// rows per run (default 25); the action re-schedules itself with the next cursor and logs the
// running totals (event "imageModeration.backfillStripMetadata") on every page and the final
// totals with `done: true`. Re-runnable: a stripped image is clean on the next pass.

const tableValidator = v.union(
  v.literal("boxArt"),
  v.literal("proposals"),
  v.literal("copy"),
  v.literal("completion"),
);

const totalsValidator = v.object({
  scanned: v.number(),
  withMetadata: v.number(),
  stripped: v.number(),
  clean: v.number(),
  skipped: v.number(),
});
type Totals = typeof totalsValidator.type;

const ZERO: Totals = {
  scanned: 0,
  withMetadata: 0,
  stripped: 0,
  clean: 0,
  skipped: 0,
};

type Item = { id: string; fileId: Id<"_storage"> };

const SKIPPED_STATUSES = new Set(["pending", "quarantined"]);

export const listPage = internalQuery({
  args: { table: tableValidator, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { table, paginationOpts }) => {
    const page =
      table === "boxArt"
        ? await ctx.db.query("puzzles").paginate(paginationOpts)
        : table === "proposals"
          ? await ctx.db.query("puzzleChangeProposals").paginate(paginationOpts)
          : table === "copy"
            ? await ctx.db.query("ownedPuzzleImages").paginate(paginationOpts)
            : await ctx.db.query("completionImages").paginate(paginationOpts);
    const items: Item[] = [];
    for (const row of page.page) {
      if ("fileId" in row) {
        if (!SKIPPED_STATUSES.has(row.moderationStatus ?? "")) {
          items.push({ id: row._id, fileId: row.fileId });
        }
      } else if ("changes" in row) {
        const fileId =
          row.changes.image &&
          ctx.db.system.normalizeId("_storage", row.changes.image);
        if (fileId) items.push({ id: row._id, fileId });
      } else if (row.image) {
        items.push({ id: row._id, fileId: row.image });
      }
    }
    return {
      scanned: page.page.length,
      items,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * Point everything that holds `from` at `to`, provided the row still holds `from`. Returns
 * whether it did; afterwards the old blob is deleted unless something else still uses it.
 */
export const swapBlob = internalMutation({
  args: {
    table: tableValidator,
    id: v.string(),
    from: v.id("_storage"),
    to: v.id("_storage"),
  },
  handler: async (ctx, { table, id, from, to }): Promise<boolean> => {
    const now = Date.now();
    if (table === "copy" || table === "completion") {
      const rowId = ctx.db.normalizeId(
        table === "copy" ? "ownedPuzzleImages" : "completionImages",
        id,
      );
      const row = rowId && (await ctx.db.get(rowId));
      if (!row || row.fileId !== from) return false;
      if (SKIPPED_STATUSES.has(row.moderationStatus ?? "")) return false;
      await ctx.db.patch(row._id, { fileId: to, updatedAt: now });
      if ("completionId" in row) {
        const completion = await ctx.db
          .query("completions")
          .withIndex("by_aggregate_id", (q) =>
            q.eq("aggregateId", row.completionId),
          )
          .unique();
        // Like the pipeline's swap: `photos` only, without bumping updatedAt (the edit window).
        if (completion?.photos.includes(from)) {
          await ctx.db.patch(completion._id, {
            photos: completion.photos.map((p) => (p === from ? to : p)),
          });
        }
      }
      return true;
    }

    // Box art: every definition and proposal (its change or its baseline) holding `from`.
    const definitions = await ctx.db
      .query("puzzles")
      .withIndex("by_image", (q) => q.eq("image", from))
      .collect();
    const proposals = await ctx.db
      .query("puzzleChangeProposals")
      .withIndex("by_changes_image", (q) => q.eq("changes.image", from))
      .collect();
    if (table === "boxArt") {
      if (!definitions.some((d) => d._id === id)) return false;
    } else if (!proposals.some((p) => p._id === id)) {
      return false;
    }
    for (const definition of definitions) {
      await ctx.db.patch(definition._id, { image: to });
      const aggregateId = definition.aggregateId;
      if (!aggregateId) continue;
      const ofDefinition = await ctx.db
        .query("puzzleChangeProposals")
        .withIndex("by_definition", (q) =>
          q.eq("puzzleDefinitionId", aggregateId),
        )
        .collect();
      proposals.push(...ofDefinition.filter((p) => p.baseline.image === from));
    }
    for (const proposal of new Map(proposals.map((p) => [p._id, p])).values()) {
      await ctx.db.patch(proposal._id, {
        changes:
          proposal.changes.image === from
            ? { ...proposal.changes, image: to }
            : proposal.changes,
        ...(proposal.baseline.image === from && {
          baseline: { ...proposal.baseline, image: to },
        }),
      });
    }
    return true;
  },
});

/** Whether nothing references the blob any more (so it may be deleted). */
export const isUnreferenced = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => !(await isReferenced(ctx, storageId)),
});

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
      internal.lib.imageModeration.backfillStripMetadata.listPage,
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
      if (dryRun) continue;

      const stripped = stripImageMetadata(bytes, format);
      if (!stripped) continue;
      const to = await ctx.storage.store(
        new Blob([stripped as BlobPart], { type: `image/${format}` }),
      );
      const swapped = await ctx.runMutation(
        internal.lib.imageModeration.backfillStripMetadata.swapBlob,
        { table: args.table, id: item.id, from: item.fileId, to },
      );
      if (!swapped) {
        await ctx.storage.delete(to);
        continue;
      }
      batch.stripped += 1;
      const unreferenced = await ctx.runQuery(
        internal.lib.imageModeration.backfillStripMetadata.isUnreferenced,
        { storageId: item.fileId },
      );
      if (unreferenced) await ctx.storage.delete(item.fileId);
    }

    const prior = args.totals ?? ZERO;
    const totals: Totals = {
      scanned: prior.scanned + batch.scanned,
      withMetadata: prior.withMetadata + batch.withMetadata,
      stripped: prior.stripped + batch.stripped,
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

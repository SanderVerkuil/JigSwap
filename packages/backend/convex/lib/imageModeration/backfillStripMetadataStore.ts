import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internalMutation, internalQuery } from "../../_generated/server";
import { isReferenced } from "./blobReferences";

// The database side of the one-shot lib/imageModeration/backfillStripMetadata (a Node action,
// for the decoder): page through a table, switch everything holding a blob to its clean copy,
// and tell whether the old blob is still used.

export const tableValidator = v.union(
  v.literal("boxArt"),
  v.literal("proposals"),
  v.literal("copy"),
  v.literal("completion"),
);

export const totalsValidator = v.object({
  scanned: v.number(),
  withMetadata: v.number(),
  stripped: v.number(),
  needsTurning: v.number(),
  turned: v.number(),
  clean: v.number(),
  skipped: v.number(),
});
export type Totals = typeof totalsValidator.type;

export const ZERO: Totals = {
  scanned: 0,
  withMetadata: 0,
  stripped: 0,
  needsTurning: 0,
  turned: 0,
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

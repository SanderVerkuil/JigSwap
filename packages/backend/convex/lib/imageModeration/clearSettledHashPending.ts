import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import { logEvent } from "../logEvent";
import { INVALID_IMAGE_LABEL } from "./guards";
import {
  moderationTableValidator,
  type ModerationTable,
} from "./moderationPool";

// One-shot (SEC-55): take the rows that no longer wait on a CSAM hash check out of the
// `by_hash_check_pending` index. The pipeline now clears `hashCheckPendingSince` itself when it
// refuses an upload and its blob is gone (quarantine.applyHashCheckResult "refused") and when it
// quarantines a photo (each table's quarantine store), but rows settled before that kept it, and
// stay in the index for good: the admin's waiting count (admin/listCsamEscalations), the
// uploader's box art in check (catalog/boxArtInCheck) and the daily hash re-check sweep
// (hashRecheckPool.sweepLostHashRechecks) keep scanning them. Run it once per deployment after
// that code is deployed.
//
// It clears `hashCheckPendingSince`, and nothing else, on a row in the index that is:
// - quarantined (a hash match: never served, never leaves quarantine); or
// - refused: "rejected" with label invalid_image, no stored hashes (`pendingHashes`, which a
//   re-check would still need: a match escalates even a refused upload), and its blob gone.
// Every other row is left alone: a photo still waiting on its check or not reached by the
// pipeline yet, one whose check timed out (an admin decides it), one an admin rejected after a
// timeout (the field is what keeps its gate closed should admin/restorePhoto restore it), and a
// refused row whose blob is still stored (restorePhoto could publish it).
//
// Clearing the field never opens a publication gate (hashCheckFields.isHashCleared): a
// quarantined row is refused whatever its fields say, and a refused row has no blob to serve.
//
// `dryRun` defaults to TRUE: it only counts. Paginated over the index: `batchSize` rows per run
// (default 50, max 100); it re-schedules itself through the page, then the next table (every
// table in turn, or only `table` when given), and logs the running totals (event
// "imageModeration.clearSettledHashPending") per page, the last with `done: true`. Safe to re-run:
// a cleared row is no longer in the index.

const TABLES: readonly ModerationTable[] = [
  "copy",
  "completion",
  "boxArt",
  "message",
  "circleIcon",
];

const totalsValidator = v.object({
  scanned: v.number(),
  settled: v.number(),
  cleared: v.number(),
});
type Totals = typeof totalsValidator.type;
const ZERO: Totals = { scanned: 0, settled: 0, cleared: 0 };

type PendingRow =
  | Doc<"ownedPuzzleImages">
  | Doc<"completionImages">
  | Doc<"boxArtUploads">
  | Doc<"messageAttachments">
  | Doc<"circleIcons">;

const pendingPage = (
  ctx: MutationCtx,
  table: ModerationTable,
  paginationOpts: { numItems: number; cursor: string | null },
) => {
  switch (table) {
    case "copy":
      return ctx.db
        .query("ownedPuzzleImages")
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .paginate(paginationOpts);
    case "completion":
      return ctx.db
        .query("completionImages")
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .paginate(paginationOpts);
    case "boxArt":
      return ctx.db
        .query("boxArtUploads")
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .paginate(paginationOpts);
    case "message":
      return ctx.db
        .query("messageAttachments")
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .paginate(paginationOpts);
    case "circleIcon":
      return ctx.db
        .query("circleIcons")
        .withIndex("by_hash_check_pending", (q) =>
          q.gt("hashCheckPendingSince", 0),
        )
        .paginate(paginationOpts);
  }
};

/** Whether the row in the index waits on nothing any more (see the header). */
const isSettled = async (
  ctx: MutationCtx,
  row: PendingRow,
): Promise<boolean> => {
  // (A shared location is never hash-checked; the index holds only photos.)
  if ("kind" in row && row.kind === "location") return false;
  if (row.moderationStatus === "quarantined") return true;
  if (
    row.moderationStatus !== "rejected" ||
    row.moderationLabel !== INVALID_IMAGE_LABEL ||
    row.pendingHashes !== undefined
  ) {
    return false;
  }
  const blob: Id<"_storage"> = "storageId" in row ? row.storageId : row.fileId;
  return (await ctx.db.system.get(blob)) === null;
};

export const clearSettledHashPending = internalMutation({
  args: {
    /** Only this table; omitted: every table in turn. */
    table: v.optional(moderationTableValidator),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    // Continuation state (set by the run itself).
    current: v.optional(moderationTableValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    totals: v.optional(totalsValidator),
  },
  handler: async (ctx, args): Promise<Totals> => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.max(1, Math.min(100, args.batchSize ?? 50));
    const table = args.current ?? args.table ?? TABLES[0];
    const page = await pendingPage(ctx, table, {
      numItems: batchSize,
      cursor: args.cursor ?? null,
    });
    const batch: Totals = { scanned: page.page.length, settled: 0, cleared: 0 };
    for (const row of page.page) {
      if (!(await isSettled(ctx, row))) continue;
      batch.settled += 1;
      if (!dryRun) {
        await ctx.db.patch(row._id, { hashCheckPendingSince: undefined });
        batch.cleared += 1;
      }
    }

    const prior = args.totals ?? ZERO;
    const totals: Totals = {
      scanned: prior.scanned + batch.scanned,
      settled: prior.settled + batch.settled,
      cleared: prior.cleared + batch.cleared,
    };
    const nextTable =
      args.table === undefined ? TABLES[TABLES.indexOf(table) + 1] : undefined;
    const done = page.isDone && nextTable === undefined;
    logEvent({
      event: "imageModeration.clearSettledHashPending",
      outcome: "success",
      table,
      dry_run: dryRun,
      done,
      ...totals,
    });
    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.imageModeration.clearSettledHashPending
          .clearSettledHashPending,
        {
          table: args.table,
          dryRun,
          batchSize,
          current: page.isDone ? nextTable : table,
          cursor: page.isDone ? null : page.continueCursor,
          totals,
        },
      );
    }
    return batch;
  },
});

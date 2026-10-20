import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import { logEvent } from "../logEvent";
import { readCsamHashCheckConfig } from "./csamHashCheck";
import { isWaivedHashRecheckCandidate } from "./hashCheckFields";
import { enqueueWaivedHashRecheck } from "./hashRecheckPool";
import {
  moderationTableValidator,
  type ModerationTable,
} from "./moderationPool";

// One-shot: the CSAM hash check of photos an admin approved WITHOUT one ("Approve without hash
// check", admin/decideUncheckedPhoto) after their check timed out (HASH_CHECK_TIMEOUT_MS). Such a
// row carries `hashCheckWaivedBy` and kept its `pendingHashes` (hashCheckFields); nothing re-checks
// it automatically. Run it right after the hash service (Offlimits) is configured on a deployment.
//
// For every candidate (isWaivedHashRecheckCandidate) of copy photos, completion photos, box art
// and message photos, one re-check of the STORED hashes is enqueued on the hash re-check Workpool
// (hashRecheckPool.enqueueWaivedHashRecheck; at most HASH_RECHECK_POOL_PARALLELISM at once), and
// the pool's job decides it exactly like a live re-check (pipeline.runHashRecheck):
// - match: the photo is quarantined and a CSAM escalation + image_quarantined stamp raised, over
//   the admin's approval (a match always wins);
// - no_match: recorded (`hashCheckedAt`), and `pendingHashes` and `hashCheckWaivedBy` cleared, so
//   the photo is hash-checked like any other and never a candidate again;
// - unavailable or an error: nothing changes; the photo stays a candidate for the next run.
//
// `dryRun` defaults to TRUE: it only counts the candidates and enqueues nothing (the hash service
// is never called). A real run (`dryRun: false`) refuses to start unless the hash check is
// configured ("ok"): the "none" adapter answers no_match to everything, which would clear the
// stored hashes unchecked. Paginated: `batchSize` rows per run (default 50); it re-schedules itself
// through the page, then the next table (all four in turn, or only `table` when given), and logs
// the running totals (event "imageModeration.recheckWaivedHashes") per page, the last with
// `done: true`. Each re-check logs its own `<table event>.hashRecheck` event.

const TABLES: readonly ModerationTable[] = [
  "copy",
  "completion",
  "boxArt",
  "message",
];

const totalsValidator = v.object({
  scanned: v.number(),
  waived: v.number(),
  enqueued: v.number(),
});
type Totals = typeof totalsValidator.type;
const ZERO: Totals = { scanned: 0, waived: 0, enqueued: 0 };

type CandidatePage = {
  scanned: number;
  ids: string[];
  isDone: boolean;
  continueCursor: string;
};

const candidatePage = async (
  ctx: MutationCtx,
  table: ModerationTable,
  paginationOpts: { numItems: number; cursor: string | null },
): Promise<CandidatePage> => {
  const page = await (() => {
    switch (table) {
      case "copy":
        return ctx.db.query("ownedPuzzleImages").paginate(paginationOpts);
      case "completion":
        return ctx.db.query("completionImages").paginate(paginationOpts);
      case "boxArt":
        return ctx.db.query("boxArtUploads").paginate(paginationOpts);
      case "message":
        return ctx.db.query("messageAttachments").paginate(paginationOpts);
    }
  })();
  const ids: string[] = [];
  for (const row of page.page) {
    // (A shared location is not a photo.)
    if ("pendingHashes" in row && isWaivedHashRecheckCandidate(row)) {
      ids.push(row._id);
    }
  }
  return {
    scanned: page.page.length,
    ids,
    isDone: page.isDone,
    continueCursor: page.continueCursor,
  };
};

export const recheckWaivedHashes = internalMutation({
  args: {
    /** Only this table; omitted: all four in turn. */
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
    const hashConfig = readCsamHashCheckConfig(process.env);
    if (!dryRun && hashConfig.status !== "ok") {
      throw new Error(
        `CSAM hash check not configured (${hashConfig.status}): nothing to check against`,
      );
    }
    const table = args.current ?? args.table ?? TABLES[0];
    const page = await candidatePage(ctx, table, {
      numItems: batchSize,
      cursor: args.cursor ?? null,
    });
    const batch: Totals = {
      scanned: page.scanned,
      waived: page.ids.length,
      enqueued: 0,
    };
    if (!dryRun) {
      for (const imageId of page.ids) {
        if (await enqueueWaivedHashRecheck(ctx, table, imageId)) {
          batch.enqueued += 1;
        }
      }
    }

    const prior = args.totals ?? ZERO;
    const totals: Totals = {
      scanned: prior.scanned + batch.scanned,
      waived: prior.waived + batch.waived,
      enqueued: prior.enqueued + batch.enqueued,
    };
    const nextTable =
      args.table === undefined ? TABLES[TABLES.indexOf(table) + 1] : undefined;
    const done = page.isDone && nextTable === undefined;
    logEvent({
      event: "imageModeration.recheckWaivedHashes",
      outcome: "success",
      table,
      dry_run: dryRun,
      done,
      csam_hashcheck_provider: hashConfig.provider,
      ...totals,
    });
    if (!done) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.imageModeration.recheckWaivedHashes.recheckWaivedHashes,
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

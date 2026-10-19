"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { logEvent, type WideEvent } from "../logEvent";
import {
  totalsValidator,
  ZERO,
  type Totals,
} from "./backfillBoxArtHashCheckStore";
import {
  checkAllHashes,
  makeCsamHashCheckPortFromEnv,
  readCsamHashCheckConfig,
} from "./csamHashCheck";
import { hashImageBytes, preserveAndQuarantine } from "./pipeline";

// One-shot: run the CSAM hash check (lib/imageModeration/csamHashCheck) on box art stored before
// box art went through the shared moderation pipeline (catalog/moderateBoxArt), which never had
// one:
// - "boxArt": puzzles.image;
// - "proposals": puzzleChangeProposals.changes.image (a proposed new box art).
// Box art whose listing already passed a hash check, or that the live pipeline owns (pending,
// quarantined, rejected), is skipped.
//
// Each image is downloaded and the MD5 + SHA-1 of its STORED bytes checked (the bytes as
// uploaded are gone for anything the metadata strip re-encoded). A match is handled exactly like
// the live pipeline's: the bytes are preserved as a new blob, the listing (created for legacy box
// art) is quarantined, the box art detached from every definition and proposal holding it, and
// a csamEscalations row + image_quarantined stamp raised (catalog/boxArtModerationStore
// .quarantine); `originalDiscarded` is true, since what was checked may not be the upload as
// sent. A no_match is recorded on the listing, so a re-run skips it. "unavailable" changes
// nothing (legacy box art stays served, as before) and is counted: re-run once the service is
// back. With no hash service configured, nothing is checked (the run refuses to start).
//
// `dryRun` defaults to TRUE: it only counts the box art still to check (`unchecked`) and calls
// nothing outside. Pass `dryRun: false` to check. Paginated: `batchSize` rows per run (default
// 25); the action re-schedules itself with the next cursor and logs the running totals (event
// "imageModeration.backfillBoxArtHashCheck") on every page and the final totals with
// `done: true`. A match logs its own event carrying only the escalation id.

export const backfillBoxArtHashCheck = internalAction({
  args: {
    table: v.union(v.literal("boxArt"), v.literal("proposals")),
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    totals: v.optional(totalsValidator),
  },
  handler: async (ctx, args): Promise<Totals> => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.max(1, Math.min(100, args.batchSize ?? 25));
    const hashConfig = readCsamHashCheckConfig(process.env);
    if (!dryRun && hashConfig.status !== "ok") {
      throw new Error(
        `CSAM hash check not configured (${hashConfig.status}): nothing to check against`,
      );
    }
    const port = makeCsamHashCheckPortFromEnv(process.env);
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
      const candidate = await ctx.runQuery(
        internal.lib.imageModeration.backfillBoxArtHashCheckStore.candidate,
        { table: args.table, id: item.id, storageId: item.fileId },
      );
      if (!candidate) {
        batch.skipped += 1;
        continue;
      }
      batch.unchecked += 1;
      if (dryRun) continue;

      const blob = await ctx.storage.get(item.fileId);
      if (!blob) {
        batch.skipped += 1;
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hashCheck = await checkAllHashes(port, [hashImageBytes(bytes)]);
      if (hashCheck.status === "match" && hashCheck.matched) {
        const imageId = await ctx.runMutation(
          internal.lib.imageModeration.backfillBoxArtHashCheckStore
            .listingForQuarantine,
          { storageId: item.fileId, uploaderId: candidate.uploaderId },
        );
        const event: WideEvent = {
          event: "imageModeration.backfillBoxArtHashCheck.match",
          outcome: "success",
        };
        await preserveAndQuarantine(
          ctx,
          internal.catalog.boxArtModerationStore.quarantine,
          event,
          {
            imageId,
            bytes,
            uploadedFileId: item.fileId,
            uploaderId: candidate.uploaderId,
            matched: hashCheck.matched,
            provider: hashConfig.provider,
            originalDiscarded: true,
          },
        );
        logEvent(event);
        batch.matched += 1;
      } else if (hashCheck.status === "no_match") {
        await ctx.runMutation(
          internal.lib.imageModeration.backfillBoxArtHashCheckStore
            .markHashChecked,
          { storageId: item.fileId, uploaderId: candidate.uploaderId },
        );
        batch.noMatch += 1;
      } else {
        batch.unavailable += 1;
      }
    }

    const prior = args.totals ?? ZERO;
    const totals: Totals = {
      scanned: prior.scanned + batch.scanned,
      unchecked: prior.unchecked + batch.unchecked,
      noMatch: prior.noMatch + batch.noMatch,
      matched: prior.matched + batch.matched,
      unavailable: prior.unavailable + batch.unavailable,
      skipped: prior.skipped + batch.skipped,
    };
    logEvent({
      event: "imageModeration.backfillBoxArtHashCheck",
      outcome: batch.unavailable > 0 ? "error" : "success",
      table: args.table,
      dry_run: dryRun,
      done: page.isDone,
      csam_hashcheck_provider: hashConfig.provider,
      ...totals,
    });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.imageModeration.backfillBoxArtHashCheck
          .backfillBoxArtHashCheck,
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

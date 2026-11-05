import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import {
  blobReferenceKinds,
  type BlobReferenceKind,
} from "../imageModeration/blobReferences";
import {
  isHashCleared,
  isWaivedHashRecheckCandidate,
} from "../imageModeration/hashCheckFields";
import { deleteRenditions } from "../imageModeration/renditionsStore";
import { logEvent } from "../logEvent";
import { hasMaintenanceMarker } from "../maintenanceMarkers";

// The storage sweep (crons.ts; SEC-20, SEC-92). Uploads are claimed once and delete paths
// keep blobs that another row holds, so a blob nothing holds stays behind whenever an upload is
// never attached (an abandoned form, a refused attach, a burst of upload URLs). This finds them:
//
// - younger than ORPHAN_MIN_AGE_MS: kept (an upload may still be attached; claim windows are
//   15 minutes);
// - held by any blob-reference kind (lib/imageModeration/blobReferences: a photo, icon, box art,
//   listing, report evidence, or a CSAM escalation that preserves it): kept;
// - held by nothing: a candidate ("orphan");
// - held only by its boxArtUploads listing (no definition shows it and no proposal proposes it, so
//   catalog's boxArtHolders is empty too), at least UNATTACHED_BOX_ART_TTL_MS old, with its checks
//   over (not pending, not quarantined, hash check passed, no waived re-check waiting): a
//   candidate ("unattachedBoxArt"), deleted with its listing so a catalog form can no longer name
//   it. A proposal's `baseline.image` alone does not keep it: that is a record of what the
//   definition showed, compared for conflicts, and its URL is only sent while the blob exists
//   (catalog/proposalReadModel).
//
// DRY RUN unless the deployment env STORAGE_GC_MODE is exactly "delete" (an owner decision; see
// docs/deployment/photo-moderation.md for the preconditions). The mode is read on every batch, so
// unsetting it stops deletion at the next batch. A dry run only logs what it would delete.
// Delete mode ALSO needs the `legacyCompletionSidecars` maintenance marker, which
// solving/backfillLegacyCompletionSidecars records once every completion photo has its sidecar:
// before that, a completion photo stored before the sidecars existed looks held by nothing and
// would be deleted. Without it the sweep stays a dry run and logs `delete_blocked`.
//
// A deleted blob's renditions go with it (renditionsStore.deleteRenditions): they are held by their
// row, so nothing else would ever remove them. They are not candidates of their own.
//
// Pages `_storage` STORAGE_SWEEP_PAGE blobs per transaction (about 15 index reads each, about 60
// when it also deletes a source and its three renditions, which keeps even a batch of nothing but
// those under Convex's 4,096 queries per function) and reschedules itself with the cursor; the age
// cutoffs are fixed when the run starts. One `storage.sweep` wide event per batch, with that
// batch's candidate ids and the run's running totals; the event with `done: true` carries the
// whole run.
//
// Two scopes, because walking every blob costs about 15 index reads per blob. Nearly every orphan is
// an upload that was never attached, which shows within RECENT_BLOB_WINDOW_MS of being stored, so
// the daily run reads only those (`scope: "recent"`). An older blob something has since let go of
// waits for the monthly pass over the whole table (`scope: "all"`, the default).

/** Blobs read per batch. */
export const STORAGE_SWEEP_PAGE = 50;

/** A blob nothing holds is only a candidate once it is this old. */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** Box art that only its listing holds is only a candidate once it is this old. */
export const UNATTACHED_BOX_ART_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How far back the daily run reads: past the last age at which a blob becomes a candidate, with
 * room for a run or two that failed. */
export const RECENT_BLOB_WINDOW_MS =
  UNATTACHED_BOX_ART_TTL_MS + 3 * 24 * 60 * 60 * 1000;

const totalsValidator = v.object({
  scanned: v.number(),
  scannedBytes: v.number(),
  young: v.number(),
  kept: v.number(),
  // Per blob-reference kind, the kept blobs it holds (a blob held by two kinds counts for each).
  keptByKind: v.record(v.string(), v.number()),
  candidates: v.number(),
  candidateBytes: v.number(),
  orphans: v.number(),
  unattachedBoxArt: v.number(),
  candidateContentTypes: v.array(
    v.object({ contentType: v.string(), count: v.number(), bytes: v.number() }),
  ),
  deleted: v.number(),
  deletedBytes: v.number(),
});

type Totals = typeof totalsValidator.type;

const NO_TOTALS: Totals = {
  scanned: 0,
  scannedBytes: 0,
  young: 0,
  kept: 0,
  keptByKind: {},
  candidates: 0,
  candidateBytes: 0,
  orphans: 0,
  unattachedBoxArt: 0,
  candidateContentTypes: [],
  deleted: 0,
  deletedBytes: 0,
};

// The `_storage` system document fields the sweep reads.
type StoredBlob = {
  _id: Id<"_storage">;
  _creationTime: number;
  size: number;
  contentType?: string;
};

type Verdict =
  | { kind: "young" }
  | { kind: "kept"; holders: Set<BlobReferenceKind> }
  | { kind: "orphan" }
  | { kind: "unattachedBoxArt"; listings: Doc<"boxArtUploads">[] };

// Whether a listing's checks are over: none still running, no CSAM match, and no hash re-check
// still owed (a match then must find the blob to preserve it).
const checksSettled = (listing: Doc<"boxArtUploads">): boolean =>
  listing.moderationStatus !== "pending" &&
  listing.moderationStatus !== "quarantined" &&
  isHashCleared(listing) &&
  !isWaivedHashRecheckCandidate(listing);

const classify = async (
  ctx: MutationCtx,
  blob: StoredBlob,
  startedAt: number,
): Promise<Verdict> => {
  const age = startedAt - blob._creationTime;
  if (age < ORPHAN_MIN_AGE_MS) return { kind: "young" };
  const holders = await blobReferenceKinds(ctx, blob._id);
  if (holders.size === 0) return { kind: "orphan" };
  if (
    holders.size === 1 &&
    holders.has("boxArtListing") &&
    age >= UNATTACHED_BOX_ART_TTL_MS
  ) {
    const listings = await ctx.db
      .query("boxArtUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", blob._id))
      .collect();
    if (listings.every(checksSettled)) {
      return { kind: "unattachedBoxArt", listings };
    }
  }
  return { kind: "kept", holders };
};

// An upload's content type is whatever the client sent, so the tally is bounded: at most
// MAX_CONTENT_TYPES entries (the rest count as "other"), each name cut to 100 characters.
const MAX_CONTENT_TYPES = 20;

const addContentType = (
  totals: Totals,
  sent: string | undefined,
  bytes: number,
): void => {
  const name = (sent ?? "unknown").slice(0, 100);
  const contentType =
    totals.candidateContentTypes.length < MAX_CONTENT_TYPES ||
    totals.candidateContentTypes.some((e) => e.contentType === name)
      ? name
      : "other";
  const entry = totals.candidateContentTypes.find(
    (e) => e.contentType === contentType,
  );
  if (entry) {
    entry.count++;
    entry.bytes += bytes;
  } else {
    totals.candidateContentTypes.push({ contentType, count: 1, bytes });
  }
};

/**
 * One batch of the storage sweep (see the module comment). The cron starts it with no arguments;
 * every later batch gets the cursor, the run's start time and the running totals.
 */
export const sweepStorage = internalMutation({
  args: {
    scope: v.optional(v.union(v.literal("all"), v.literal("recent"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    startedAt: v.optional(v.number()),
    totals: v.optional(totalsValidator),
  },
  handler: async (ctx, args): Promise<Totals & { done: boolean }> => {
    const scope = args.scope ?? "all";
    const startedAt = args.startedAt ?? Date.now();
    const deleteRequested = process.env.STORAGE_GC_MODE === "delete";
    const deleting =
      deleteRequested &&
      (await hasMaintenanceMarker(ctx, "legacyCompletionSidecars"));
    const blobs =
      scope === "recent"
        ? ctx.db.system
            .query("_storage")
            .withIndex("by_creation_time", (q) =>
              q.gte("_creationTime", startedAt - RECENT_BLOB_WINDOW_MS),
            )
        : ctx.db.system.query("_storage");
    const page = await blobs.paginate({
      numItems: STORAGE_SWEEP_PAGE,
      cursor: args.cursor ?? null,
    });

    const previous = args.totals ?? NO_TOTALS;
    const totals: Totals = {
      ...previous,
      keptByKind: { ...previous.keptByKind },
      candidateContentTypes: previous.candidateContentTypes.map((e) => ({
        ...e,
      })),
    };
    const candidateIds: Id<"_storage">[] = [];
    for (const blob of page.page) {
      // Deleted a moment ago, as a rendition of a source earlier in this batch.
      if (deleting && !(await ctx.db.system.get(blob._id))) continue;
      totals.scanned++;
      totals.scannedBytes += blob.size;
      const verdict = await classify(ctx, blob, startedAt);
      switch (verdict.kind) {
        case "young":
          totals.young++;
          continue;
        case "kept":
          totals.kept++;
          for (const kind of verdict.holders) {
            totals.keptByKind[kind] = (totals.keptByKind[kind] ?? 0) + 1;
          }
          continue;
        case "orphan":
          totals.orphans++;
          break;
        case "unattachedBoxArt":
          totals.unattachedBoxArt++;
          break;
      }
      candidateIds.push(blob._id);
      totals.candidates++;
      totals.candidateBytes += blob.size;
      addContentType(totals, blob.contentType, blob.size);
      if (!deleting) continue;
      if (verdict.kind === "unattachedBoxArt") {
        for (const listing of verdict.listings) {
          await ctx.db.delete(listing._id);
        }
      }
      await deleteRenditions(ctx, blob._id);
      await ctx.storage.delete(blob._id);
      totals.deleted++;
      totals.deletedBytes += blob.size;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.lib.storage.storageSweep.sweepStorage,
        { scope, cursor: page.continueCursor, startedAt, totals },
      );
    }
    logEvent({
      event: "storage.sweep",
      outcome: "success",
      scope,
      mode: deleting ? "delete" : "dry_run",
      delete_blocked:
        deleteRequested && !deleting
          ? "legacy_completion_sidecars_not_backfilled"
          : undefined,
      done: page.isDone,
      started_at: startedAt,
      batch_scanned: page.page.length,
      batch_candidate_ids: candidateIds,
      scanned: totals.scanned,
      scanned_bytes: totals.scannedBytes,
      young: totals.young,
      kept: totals.kept,
      kept_by_kind: totals.keptByKind,
      candidates: totals.candidates,
      candidate_bytes: totals.candidateBytes,
      orphans: totals.orphans,
      unattached_box_art: totals.unattachedBoxArt,
      candidate_content_types: totals.candidateContentTypes,
      deleted: totals.deleted,
      deleted_bytes: totals.deletedBytes,
    });
    return { ...totals, done: page.isDone };
  },
});

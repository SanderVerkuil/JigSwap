import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { deleteCopyPhoto } from "../admin/deleteCopyPhoto";
import { stampModerationAction } from "../admin/stampModerationAction";
import { isHashCleared } from "../lib/imageModeration/hashCheckFields";
import {
  applyHashCheckResult,
  hashCheckResultArgs,
  quarantineArgs,
  recordCsamEscalation,
} from "../lib/imageModeration/quarantine";
import {
  DAY_MS,
  logRetentionSweep,
  RETENTION_SWEEP_PAGE,
  retentionEnforced,
} from "../lib/retention";
import { needsRescreen } from "./adapters/photoModeration";

// DB-facing helpers for the moderatePhoto Node action. A Node action (`"use node"`) has no direct
// `ctx.db` access, so it reads/writes the `ownedPuzzleImages` row through these internal functions.

// Load the minimal row fields the moderation pipeline needs. Returns null when the row vanished.
export const getImageForModeration = internalQuery({
  args: { imageId: v.id("ownedPuzzleImages") },
  handler: async (ctx, { imageId }) => {
    const row = await ctx.db.get(imageId);
    if (!row) return null;
    return {
      fileId: row.fileId,
      moderationStatus: row.moderationStatus,
      reencodedAt: row.reencodedAt,
      hashCheckedAt: row.hashCheckedAt,
      pendingHashes: row.pendingHashes,
      hashCheckWaivedBy: row.hashCheckWaivedBy,
      hashCheckSkippedAt: row.hashCheckSkippedAt,
      // Business context for the wide event (which copy / who uploaded / what kind of shot).
      ownedPuzzleId: row.ownedPuzzleId,
      uploaderId: row.uploaderId,
      tag: row.tag,
    };
  },
});

// Swap the row's stored file to the re-encoded blob (EXIF stripped). Separate from the verdict
// patch so the re-encode is durable even if classification is retried.
export const setModerationFile = internalMutation({
  args: {
    imageId: v.id("ownedPuzzleImages"),
    fileId: v.id("_storage"),
    // The clean image's blurhash (lib/blurhash), computed from the same decode.
    blurhash: v.optional(v.string()),
  },
  handler: async (ctx, { imageId, fileId, blurhash }) => {
    const exists = await ctx.db.get(imageId);
    if (!exists) return;
    const now = Date.now();
    await ctx.db.patch(imageId, {
      fileId,
      blurhash,
      reencodedAt: now,
      updatedAt: now,
    });
  },
});

// Verdict arguments shared by the pipeline and the re-screen. `moderationReason` is the
// UnscoredReason of an "unscored" verdict; `moderationAttempts` how many classify attempts ran.
const verdictArgs = {
  imageId: v.id("ownedPuzzleImages"),
  moderationStatus: v.union(
    v.literal("approved"),
    v.literal("rejected"),
    v.literal("unscored"),
  ),
  moderationScore: v.optional(v.number()),
  moderationLabel: v.optional(v.string()),
  moderationReason: v.optional(v.string()),
  moderationAttempts: v.optional(v.number()),
};

type Verdict = {
  imageId: Id<"ownedPuzzleImages">;
  moderationStatus: "approved" | "rejected" | "unscored";
  moderationScore?: number;
  moderationLabel?: string;
  moderationReason?: string;
  moderationAttempts?: number;
};

// Write a verdict onto a row the caller has already decided may take it. On a transition INTO
// rejected it also stamps the automated decision on the audit trail (no actorId = system); the
// label is the puzzle title via the copy's cached snapshot (falling back to the puzzle row, then
// the image id).
const writeVerdict = async (
  ctx: MutationCtx,
  row: Doc<"ownedPuzzleImages">,
  args: Verdict,
) => {
  await ctx.db.patch(args.imageId, {
    moderationStatus: args.moderationStatus,
    moderationScore: args.moderationScore,
    moderationLabel: args.moderationLabel,
    moderationReason: args.moderationReason,
    moderationAttempts: args.moderationAttempts,
    updatedAt: Date.now(),
  });
  if (args.moderationStatus === "rejected") {
    const copy = await ctx.db.get(row.ownedPuzzleId);
    const title =
      copy?.snapshot?.title ??
      (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);
    await stampModerationAction(ctx, {
      kind: "photo_auto_rejected",
      targetLabel: title ?? args.imageId,
      targetId: args.imageId,
    });
  }
};

// Record the classifier verdict. Only patches a row that still exists AND is still pending —
// FIRST VERDICT WINS. A re-run (retried or concurrently drained action) on a decided row is a
// full no-op; in particular a late "unscored" can never overwrite a rejection or an approval.
export const setModerationVerdict = internalMutation({
  args: verdictArgs,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.imageId);
    if (!row) return;
    // First verdict wins: an absent status is legacy-approved, anything else is already decided.
    if (row.moderationStatus !== "pending") return;
    await writeVerdict(ctx, row, args);
  },
});

// A CSAM hash match (lib/imageModeration/quarantine). FORCES the row to "quarantined" whatever
// its status now (an admin decision or a retry may have landed while the check ran), points it at
// the preserved blob, clears the copy's cover when it is this photo, and ALWAYS raises the
// escalation, even when the row is gone (the uploader removed it meanwhile). The blob stays.
export const quarantineImage = internalMutation({
  args: { imageId: v.id("ownedPuzzleImages"), ...quarantineArgs },
  handler: async (ctx, { imageId, ...match }) => {
    const row = await ctx.db.get(imageId);
    if (row) {
      await ctx.db.patch(imageId, {
        moderationStatus: "quarantined",
        ...(match.fileId ? { fileId: match.fileId } : {}),
        pendingHashes: undefined,
        // A quarantined photo waits on nothing: it leaves the hash-pending index (SEC-55).
        hashCheckPendingSince: undefined,
        updatedAt: Date.now(),
      });
      const copy = await ctx.db.get(row.ownedPuzzleId);
      if (copy?.coverImageId === imageId) {
        await ctx.db.patch(copy._id, { coverImageId: undefined });
      }
    }
    return recordCsamEscalation(ctx, {
      table: "ownedPuzzleImages",
      rowId: imageId,
      ...match,
    });
  },
});

// Record the CSAM hash-check outcome (lib/imageModeration/quarantine.applyHashCheckResult).
export const setHashCheck = internalMutation({
  args: { imageId: v.id("ownedPuzzleImages"), ...hashCheckResultArgs },
  handler: (ctx, { imageId, ...result }) =>
    applyHashCheckResult(ctx, imageId, result),
});

// One page of rows for the re-screen: ids + file of the candidates, plus page bookkeeping.
export const listRescreenCandidates = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db
      .query("ownedPuzzleImages")
      .paginate(paginationOpts);
    return {
      scanned: page.page.length,
      candidates: page.page.filter(needsRescreen).map((row) => ({
        imageId: row._id as string,
        fileId: row.fileId,
        uploaderId: row.uploaderId,
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

// Apply a re-screen verdict. Only a SCORED verdict (approved/rejected) is written, and only while
// the row still needs a re-screen — a photo an admin restored, or that the live pipeline decided
// meanwhile, is left alone. Returns whether the row was patched.
export const applyRescreenVerdict = internalMutation({
  args: {
    imageId: v.id("ownedPuzzleImages"),
    moderationStatus: v.union(v.literal("approved"), v.literal("rejected")),
    moderationScore: v.number(),
    moderationLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.imageId);
    if (!row || !needsRescreen(row)) return false;
    await writeVerdict(ctx, row, {
      ...args,
      moderationReason: undefined,
      moderationAttempts: (row.moderationAttempts ?? 0) + 1,
    });
    return true;
  },
});

/**
 * A copy photo the automated check rejected is deleted this long after the rejection (spec 2.8,
 * the privacy policy's "kept for 30 days so you can ask for a review ..., then deleted").
 */
export const REJECTED_COPY_PHOTO_TTL_MS = 30 * DAY_MS;

/**
 * The daily retention sweep of auto-rejected copy photos (crons.ts; lib/retention, sweep
 * "copyPhotos"): a photo the automated check rejected (no `moderatedBy`) and nobody decided
 * since, rejected (last touched, `updatedAt`) more than REJECTED_COPY_PHOTO_TTL_MS ago, is
 * deleted with its blob (admin/deleteCopyPhoto: clears the copy's cover, keeps a blob preserved
 * for a CSAM escalation), only when RETENTION_ENFORCE names the sweep; otherwise it is counted
 * and nothing changes. Until then it stays in the admin's Flagged Images queue (restore / confirm
 * removal). A person's rejection (admin/decideUncheckedPhoto, `moderatedBy`) is not the check's
 * and is left to that queue. Never touched, only counted: a photo an open report is about, and
 * one whose CSAM hash check has not finished (a late match must still find the bytes to
 * preserve). One page of the by_moderation_status range per run (rows created before the
 * cutoff), re-scheduling itself.
 */
export const sweepRejectedCopyPhotos = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const cutoff = now - REJECTED_COPY_PHOTO_TTL_MS;
    const enforce = retentionEnforced("copyPhotos");
    const page = await ctx.db
      .query("ownedPuzzleImages")
      .withIndex("by_moderation_status", (q) =>
        q.eq("moderationStatus", "rejected").lt("_creationTime", cutoff),
      )
      .paginate({
        numItems: RETENTION_SWEEP_PAGE,
        cursor: args.cursor ?? null,
      });
    let due = 0;
    let acted = 0;
    let heldReport = 0;
    let heldHashCheck = 0;
    for (const row of page.page) {
      if (row.moderatedBy !== undefined || row.updatedAt > cutoff) continue;
      if (!isHashCleared(row)) {
        heldHashCheck++;
        continue;
      }
      const openReport = await ctx.db
        .query("reports")
        .withIndex("by_target", (q) =>
          q.eq("targetKind", "photo").eq("targetId", row._id),
        )
        .filter((q) => q.eq(q.field("status"), "open"))
        .first();
      if (openReport) {
        heldReport++;
        continue;
      }
      due++;
      if (!enforce) continue;
      await deleteCopyPhoto(ctx, row, await ctx.db.get(row.ownedPuzzleId));
      acted++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.library.moderationStore.sweepRejectedCopyPhotos,
        { cursor: page.continueCursor, now },
      );
    }
    logRetentionSweep({
      sweep: "copyPhotos",
      due,
      acted,
      dryRun: !enforce,
      isDone: page.isDone,
      held_report: heldReport,
      held_hash_check: heldHashCheck,
    });
  },
});

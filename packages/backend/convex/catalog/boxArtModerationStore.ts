import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { requireMember } from "../identity/requireMember";
import { isReferenced } from "../lib/imageModeration/blobReferences";
import {
  boxArtHolders,
  repointBoxArt,
} from "../lib/imageModeration/boxArtReferences";
import {
  applyHashCheckResult,
  hashCheckResultArgs,
  isPreservedBlob,
  quarantineArgs,
  recordCsamEscalation,
} from "../lib/imageModeration/quarantine";
import { needsRescreen } from "../library/adapters/photoModeration";
import { BOX_ART_CLAIM_WINDOW_MS } from "./boxArtUploads";

// DB-facing steps of the shared image-moderation pipeline (lib/imageModeration/pipeline) for box
// art, typed to `boxArtUploads` (catalog/moderateBoxArt runs the pipeline). Mirrors
// library/moderationStore and solving/completionModerationStore. Box art is also held by the
// definitions and proposals it was attached to (lib/imageModeration/boxArtReferences), so a file
// swap re-points them, and a rejection or a quarantine detaches it from them.

/**
 * Claim a fresh upload as box art for the acting member: it exists, is recent, and nothing
 * references it yet (so the pipeline, which deletes the upload, can never destroy another
 * photo). Lists it "pending" behind the hash-check gate. Returns the row id, or null.
 */
export const claimUpload = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const uploaderId = (await requireMember(ctx)) as unknown as Id<"users">;
    const blob = await ctx.db.system.get(storageId);
    if (!blob || Date.now() - blob._creationTime > BOX_ART_CLAIM_WINDOW_MS) {
      return null;
    }
    if (await isReferenced(ctx, storageId)) return null;
    const now = Date.now();
    return ctx.db.insert("boxArtUploads", {
      storageId,
      uploaderId,
      moderationStatus: "pending",
      hashCheckPendingSince: now,
      createdAt: now,
    });
  },
});

// The pipeline's row view (`fileId` is the row's `storageId`). Null when the row vanished.
export const getForModeration = internalQuery({
  args: { imageId: v.id("boxArtUploads") },
  handler: async (ctx, { imageId }) => {
    const row = await ctx.db.get(imageId);
    if (!row) return null;
    return {
      fileId: row.storageId,
      moderationStatus: row.moderationStatus,
      moderationLabel: row.moderationLabel,
      moderationReason: row.moderationReason,
      reencodedAt: row.reencodedAt,
      hashCheckedAt: row.hashCheckedAt,
      pendingHashes: row.pendingHashes,
      hashCheckWaivedBy: row.hashCheckWaivedBy,
      uploaderId: row.uploaderId,
    };
  },
});

// Swap the row to the re-encoded blob, and every definition or proposal already holding the
// upload with it (a retry may swap after the id was handed out).
export const setFile = internalMutation({
  args: {
    imageId: v.id("boxArtUploads"),
    fileId: v.id("_storage"),
    blurhash: v.optional(v.string()),
  },
  handler: async (ctx, { imageId, fileId }) => {
    const row = await ctx.db.get(imageId);
    if (!row) return;
    await ctx.db.patch(imageId, { storageId: fileId, reencodedAt: Date.now() });
    const holders = await boxArtHolders(ctx, row.storageId);
    await repointBoxArt(ctx, holders, row.storageId, fileId);
  },
});

// Detach rejected box art from whatever holds it and delete its blob (unless an escalation
// preserves it), like a rejected completion photo. The row survives as the audit record. Also
// used by an admin's manual rejection (admin/decideUncheckedPhoto).
export const detachRejectedBoxArt = async (
  ctx: MutationCtx,
  row: Doc<"boxArtUploads">,
) => {
  await repointBoxArt(
    ctx,
    await boxArtHolders(ctx, row.storageId),
    row.storageId,
    undefined,
  );
  if (!(await isPreservedBlob(ctx, row.storageId))) {
    try {
      await ctx.storage.delete(row.storageId);
    } catch {
      // Already gone; nothing references it either way.
    }
  }
};

// Record the verdict. FIRST VERDICT WINS: only a row still pending takes it. A rejection
// detaches and deletes the box art and stamps the automated decision on the audit trail.
export const setVerdict = internalMutation({
  args: {
    imageId: v.id("boxArtUploads"),
    moderationStatus: v.union(
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("unscored"),
    ),
    moderationScore: v.optional(v.number()),
    moderationLabel: v.optional(v.string()),
    moderationReason: v.optional(v.string()),
    moderationAttempts: v.optional(v.number()),
  },
  handler: async (ctx, { imageId, ...verdict }) => {
    const row = await ctx.db.get(imageId);
    if (!row || row.moderationStatus !== "pending") return;
    await ctx.db.patch(imageId, verdict);
    if (verdict.moderationStatus !== "rejected") return;
    await detachRejectedBoxArt(ctx, row);
    await stampModerationAction(ctx, {
      kind: "photo_auto_rejected",
      targetLabel: "Box art",
      targetId: imageId,
    });
  },
});

// A CSAM hash match (lib/imageModeration/quarantine). FORCES the row to "quarantined" whatever its
// status now, points it at the preserved blob, detaches the box art from every definition and
// proposal holding it, and ALWAYS raises the escalation, even when the row is gone.
export const quarantine = internalMutation({
  args: { imageId: v.id("boxArtUploads"), ...quarantineArgs },
  handler: async (ctx, { imageId, ...match }) => {
    const row = await ctx.db.get(imageId);
    if (row) {
      await ctx.db.patch(imageId, {
        moderationStatus: "quarantined",
        ...(match.fileId ? { storageId: match.fileId } : {}),
        pendingHashes: undefined,
      });
      await repointBoxArt(
        ctx,
        await boxArtHolders(ctx, row.storageId),
        row.storageId,
        undefined,
      );
    }
    return recordCsamEscalation(ctx, {
      table: "boxArtUploads",
      rowId: imageId,
      ...match,
    });
  },
});

// Record the CSAM hash-check outcome (lib/imageModeration/quarantine.applyHashCheckResult).
export const setHashCheck = internalMutation({
  args: { imageId: v.id("boxArtUploads"), ...hashCheckResultArgs },
  handler: (ctx, { imageId, ...result }) =>
    applyHashCheckResult(ctx, imageId, result),
});

// Apply a re-screen verdict (library/rescreenPhotos) to box art that was never classified (see
// needsRescreen: unscored, or approved/legacy without a score, and not decided by an admin). Only
// a SCORED verdict comes here. A rejection has the live pipeline's side effects: detached from
// every definition and proposal, blob deleted, photo_auto_rejected stamped. Returns whether the
// listing was patched.
export const applyRescreenVerdict = internalMutation({
  args: {
    imageId: v.id("boxArtUploads"),
    moderationStatus: v.union(v.literal("approved"), v.literal("rejected")),
    moderationScore: v.number(),
    moderationLabel: v.optional(v.string()),
  },
  handler: async (ctx, { imageId, ...verdict }) => {
    const row = await ctx.db.get(imageId);
    if (!row || !needsRescreen(row)) return false;
    await ctx.db.patch(imageId, {
      ...verdict,
      moderationReason: undefined,
      moderationAttempts: (row.moderationAttempts ?? 0) + 1,
    });
    if (verdict.moderationStatus === "rejected") {
      await detachRejectedBoxArt(ctx, row);
      await stampModerationAction(ctx, {
        kind: "photo_auto_rejected",
        targetLabel: "Box art",
        targetId: imageId,
      });
    }
    return true;
  },
});

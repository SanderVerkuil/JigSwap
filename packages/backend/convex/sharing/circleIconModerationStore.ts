import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import {
  applyHashCheckResult,
  hashCheckResultArgs,
  isPreservedBlob,
  quarantineArgs,
  recordCsamEscalation,
} from "../lib/imageModeration/quarantine";
import { settleCircleIcon } from "./circleIcons";

// DB-facing steps of the shared image-moderation pipeline (lib/imageModeration/pipeline) for circle
// icons, typed to `circleIcons` (sharing/moderateCircleIcon runs the pipeline). Mirrors
// catalog/boxArtModerationStore: a rejection deletes the blob (the row stays, for the uploader's
// "removed" notice), and any write that makes the icon servable settles it as the circle's icon
// (sharing/circleIcons.settleCircleIcon).

/** The audit-trail label: which kind of photo, never the circle's name. */
export const CIRCLE_ICON_LABEL = "Circle icon";

// The pipeline's row view. Null when the row vanished (replaced or removed meanwhile).
export const getForModeration = internalQuery({
  args: { imageId: v.id("circleIcons") },
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
      uploaderId: row.uploaderId,
      circleId: row.circleId,
    };
  },
});

// Point the row at the re-encoded blob. When the row went meanwhile (a newer upload or a remove),
// the new blob is referenced by nothing, so it is deleted here.
export const setFile = internalMutation({
  args: {
    imageId: v.id("circleIcons"),
    fileId: v.id("_storage"),
    blurhash: v.optional(v.string()),
  },
  handler: async (ctx, { imageId, fileId, blurhash }) => {
    const row = await ctx.db.get(imageId);
    if (!row) {
      await ctx.storage.delete(fileId);
      return;
    }
    const now = Date.now();
    await ctx.db.patch(imageId, {
      fileId,
      blurhash,
      reencodedAt: now,
      updatedAt: now,
    });
  },
});

// Record the verdict. FIRST VERDICT WINS: only a row still pending takes it. A rejection deletes
// the blob (unless an escalation preserves it) and stamps the automated decision; an approval
// settles the icon.
export const setVerdict = internalMutation({
  args: {
    imageId: v.id("circleIcons"),
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
    await ctx.db.patch(imageId, { ...verdict, updatedAt: Date.now() });
    if (verdict.moderationStatus === "approved") {
      await settleCircleIcon(ctx, imageId);
      return;
    }
    if (verdict.moderationStatus !== "rejected") return;
    if (!(await isPreservedBlob(ctx, row.fileId))) {
      try {
        await ctx.storage.delete(row.fileId);
      } catch {
        // Already gone.
      }
    }
    await stampModerationAction(ctx, {
      kind: "photo_auto_rejected",
      targetLabel: CIRCLE_ICON_LABEL,
      targetId: imageId,
    });
  },
});

// A CSAM hash match (lib/imageModeration/quarantine). FORCES the row to "quarantined" whatever its
// status now, points it at the preserved blob, and ALWAYS raises the escalation, even when the row
// is gone.
export const quarantine = internalMutation({
  args: { imageId: v.id("circleIcons"), ...quarantineArgs },
  handler: async (ctx, { imageId, ...match }) => {
    const row = await ctx.db.get(imageId);
    if (row) {
      await ctx.db.patch(imageId, {
        moderationStatus: "quarantined",
        ...(match.fileId ? { fileId: match.fileId } : {}),
        pendingHashes: undefined,
        updatedAt: Date.now(),
      });
    }
    return recordCsamEscalation(ctx, {
      table: "circleIcons",
      rowId: imageId,
      ...match,
    });
  },
});

// Record the CSAM hash-check outcome; a no_match on an approved icon (an approval that waited on
// an unavailable hash service) makes it the circle's icon.
export const setHashCheck = internalMutation({
  args: { imageId: v.id("circleIcons"), ...hashCheckResultArgs },
  handler: async (ctx, { imageId, ...result }) => {
    await applyHashCheckResult(ctx, imageId, result);
    await settleCircleIcon(ctx, imageId);
  },
});

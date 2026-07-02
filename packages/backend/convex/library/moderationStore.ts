import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";

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
  },
  handler: async (ctx, { imageId, fileId }) => {
    const exists = await ctx.db.get(imageId);
    if (!exists) return;
    await ctx.db.patch(imageId, { fileId, updatedAt: Date.now() });
  },
});

// Record the classifier verdict. Only patches a row that still exists.
export const setModerationVerdict = internalMutation({
  args: {
    imageId: v.id("ownedPuzzleImages"),
    moderationStatus: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    moderationScore: v.optional(v.number()),
    moderationLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.imageId);
    if (!row) return;
    await ctx.db.patch(args.imageId, {
      moderationStatus: args.moderationStatus,
      moderationScore: args.moderationScore,
      moderationLabel: args.moderationLabel,
      updatedAt: Date.now(),
    });
    // Audit trail: this is the single place the pipeline writes "rejected", so the automated
    // decision is stamped here (no actorId = system). Only on the transition INTO rejected, so a
    // re-run cannot double-stamp. The label is the puzzle title via the copy's cached snapshot
    // (falling back to the puzzle row, then the image id).
    if (
      args.moderationStatus === "rejected" &&
      row.moderationStatus !== "rejected"
    ) {
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
  },
});

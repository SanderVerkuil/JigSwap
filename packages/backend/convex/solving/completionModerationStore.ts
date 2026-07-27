import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";

// DB-facing helpers for the moderateCompletionPhoto Node action, mirroring
// `library/moderationStore.ts` but typed to the `completionImages` sidecar table. A Node action
// (`"use node"`) has no direct `ctx.db` access, so it reads/writes through these internal
// functions. Unlike the library table, completion photos ALSO live in the parent `completions`
// row's `photos` array, so the file swap and the rejection each patch that row too — direct
// system writes, deliberately outside the Solving domain path (moderation is not a member edit).

// Load the minimal row fields the moderation pipeline needs. Returns null when the row vanished.
export const getImageForModeration = internalQuery({
  args: { imageId: v.id("completionImages") },
  handler: async (ctx, { imageId }) => {
    const row = await ctx.db.get(imageId);
    if (!row) return null;
    return {
      fileId: row.fileId,
      moderationStatus: row.moderationStatus,
      // Business context for the wide event (which completion / who uploaded).
      completionId: row.completionId,
      uploaderId: row.uploaderId,
    };
  },
});

// Swap the sidecar's stored file to the re-encoded blob (EXIF stripped) AND swap old→new inside
// the parent completions row's `photos` array in the same mutation, so the two references never
// diverge. Separate from the verdict patch so the re-encode is durable even if classification is
// retried. Decode-failure approvals never come through here (the action classifies the original;
// verdict-only). The old blob's deletion stays in the action, like the library pipeline.
export const setModerationFile = internalMutation({
  args: {
    imageId: v.id("completionImages"),
    fileId: v.id("_storage"),
  },
  handler: async (ctx, { imageId, fileId }) => {
    const row = await ctx.db.get(imageId);
    if (!row) return;
    const oldFileId = row.fileId;
    await ctx.db.patch(imageId, { fileId, updatedAt: Date.now() });

    const completion = await ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", row.completionId),
      )
      .unique();
    if (!completion) return;
    // Direct system write to `photos` only — deliberately outside the domain path, and NOT
    // bumping the row's updatedAt (which anchors the edit window; a background swap must not
    // shift it).
    await ctx.db.patch(completion._id, {
      photos: completion.photos.map((id) => (id === oldFileId ? fileId : id)),
    });
  },
});

// Record the classifier verdict. Only patches a row that still exists. On the transition INTO
// "rejected" this deliberately does MORE than the library's verdict mutation (library photos live
// solely in their own table): it also drops the id from the completions row's `photos` array
// (freeing a cap slot), deletes the blob, and stamps the audit row — the sidecar itself survives
// as the audit record.
export const setModerationVerdict = internalMutation({
  args: {
    imageId: v.id("completionImages"),
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
    // Only on the transition INTO rejected, so a re-run cannot double-stamp or double-delete.
    if (
      args.moderationStatus !== "rejected" ||
      row.moderationStatus === "rejected"
    ) {
      return;
    }

    const completion = await ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", row.completionId),
      )
      .unique();
    if (completion) {
      // Direct system write (see setModerationFile): remove the photo, don't touch updatedAt.
      await ctx.db.patch(completion._id, {
        photos: completion.photos.filter((id) => id !== row.fileId),
      });
    }
    // Tolerate an already-deleted blob; don't fail the verdict over a missing file.
    try {
      await ctx.storage.delete(row.fileId);
    } catch {
      // Nothing references it either way.
    }
    // Audit trail: this is the single place the pipeline writes "rejected" (no actorId = system).
    // Target the completion aggregate; label via the completion's cached copy snapshot.
    await stampModerationAction(ctx, {
      kind: "photo_auto_rejected",
      targetLabel: completion?.copySnapshot?.title ?? "Completion photo",
      targetId: row.completionId,
    });
  },
});

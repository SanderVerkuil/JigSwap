import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { stampModerationAction } from "../admin/stampModerationAction";
import { needsRescreen } from "../library/adapters/photoModeration";

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
    // The clean image's blurhash (lib/blurhash), computed from the same decode.
    blurhash: v.optional(v.string()),
  },
  handler: async (ctx, { imageId, fileId, blurhash }) => {
    const row = await ctx.db.get(imageId);
    if (!row) return;
    const oldFileId = row.fileId;
    await ctx.db.patch(imageId, { fileId, blurhash, updatedAt: Date.now() });

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

type Verdict = {
  imageId: Id<"completionImages">;
  moderationStatus: "approved" | "rejected" | "unscored";
  moderationScore?: number;
  moderationLabel?: string;
  moderationReason?: string;
  moderationAttempts?: number;
};

// Write a verdict onto a sidecar the caller has already decided may take it. On a transition INTO
// rejected this deliberately does MORE than the library's verdict (library photos live solely in
// their own table): it also drops the id from the completions row's `photos` array (freeing a cap
// slot), deletes the blob, and stamps the audit row — the sidecar itself survives as the audit
// record.
const writeVerdict = async (
  ctx: MutationCtx,
  row: Doc<"completionImages">,
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
  if (args.moderationStatus !== "rejected") return;
  const title = await detachRejectedCompletionPhoto(ctx, row);
  // Audit trail (no actorId = system). Target the completion aggregate.
  await stampModerationAction(ctx, {
    kind: "photo_auto_rejected",
    targetLabel: title,
    targetId: row.completionId,
  });
};

/**
 * The side effects of rejecting a completion photo (automated or by an admin): drop its id from
 * the completions row's `photos` array (a direct system write that frees a cap slot and leaves
 * updatedAt alone) and delete the blob. The sidecar survives as the audit record. Returns the
 * label for the audit stamp (the completion's cached copy title).
 */
export const detachRejectedCompletionPhoto = async (
  ctx: MutationCtx,
  row: Doc<"completionImages">,
): Promise<string> => {
  const completion = await ctx.db
    .query("completions")
    .withIndex("by_aggregate_id", (q) => q.eq("aggregateId", row.completionId))
    .unique();
  if (completion) {
    await ctx.db.patch(completion._id, {
      photos: completion.photos.filter((id) => id !== row.fileId),
    });
  }
  // Tolerate an already-deleted blob; don't fail the decision over a missing file.
  try {
    await ctx.storage.delete(row.fileId);
  } catch {
    // Nothing references it either way.
  }
  return completion?.copySnapshot?.title ?? "Completion photo";
};

// Record the classifier verdict. Only patches a row that still exists AND is still pending —
// FIRST VERDICT WINS. A re-run (retried or concurrently drained action) on a decided row is a
// full no-op; in particular a late "unscored" can never overwrite a rejection or an approval, and
// the reject side effects can never run twice.
export const setModerationVerdict = internalMutation({
  args: {
    imageId: v.id("completionImages"),
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
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.imageId);
    if (!row) return;
    // First verdict wins: an absent status is legacy-approved, anything else is already decided.
    if (row.moderationStatus !== "pending") return;
    await writeVerdict(ctx, row, args);
  },
});

// One page of sidecars for the re-screen (same candidate rule as the library: unscored, or
// approved without a score). Completion photos that predate sidecars have no row and are not
// covered.
export const listRescreenCandidates = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db
      .query("completionImages")
      .paginate(paginationOpts);
    return {
      scanned: page.page.length,
      candidates: page.page
        .filter(needsRescreen)
        .map((row) => ({ imageId: row._id as string, fileId: row.fileId })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

// Apply a scored re-screen verdict while the sidecar still needs one (see the library twin).
export const applyRescreenVerdict = internalMutation({
  args: {
    imageId: v.id("completionImages"),
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

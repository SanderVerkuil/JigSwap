import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { MESSAGE_PHOTO_LABEL } from "../conversation/messageAttachments";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { boxArtTitle } from "../lib/imageModeration/boxArtReferences";
import { enqueueImageModeration } from "../lib/imageModeration/moderationPool";
import { CIRCLE_ICON_LABEL } from "../sharing/circleIconModerationStore";
import { stampModerationAction } from "./stampModerationAction";

// Send an "unscored" photo through the shared moderation pipeline again: a copy photo
// (library/moderatePhoto), a completion photo (solving/moderateCompletionPhoto), box art
// (catalog/moderateBoxArt), a message photo or a circle icon (sharing/moderateCircleIcon), enqueued on the moderation Workpool like an upload's check. A photo whose check never
// completed (the retries ran out, or the classifier was unavailable or misconfigured) stays
// unpublished until it is decided; once the classifier works again, an admin can re-check it
// instead of deciding it by hand (admin/decideUncheckedPhoto). Admin-only (isAdmin, server-side).
//
// The row goes back to "pending" with a fresh attempt count and the pipeline runs from attempt 1:
// steps already done (the re-encode, a passed hash check) are skipped, the classifier runs, and a
// retryable failure backs off as on upload. Only an unscored row is re-checked. A pending row is
// a no-op: it is still being checked (another run could race the pool's retry), which also
// makes a double click harmless, as the first click already turned the row pending. A decided
// row (approved, rejected, quarantined, or legacy without a status) is final and refused.
//
// A re-check that queues a check is stamped on the audit trail (photo_recheck_requested, labelled
// like admin/decideUncheckedPhoto labels its decisions); a no-op or a refusal is not (SEC-56).
const shouldRecheck = (status: string | undefined): boolean => {
  if (status === "unscored") return true;
  if (status === "pending") return false;
  throw new ConvexError("Only unchecked photos can be checked again");
};

const notFound = () => new ConvexError("Photo not found");

// What the pipeline's first attempt expects of a row it checks.
const backToPending = {
  moderationStatus: "pending",
  moderationReason: undefined,
  moderationAttempts: undefined,
} as const;

// One audit row per re-check that queued a check.
const stampRecheck = (
  ctx: MutationCtx,
  actorId: Id<"users">,
  imageId: string,
  targetLabel: string,
) =>
  stampModerationAction(ctx, {
    actorId,
    kind: "photo_recheck_requested",
    targetLabel,
    targetId: imageId,
  });

export const recheckPhoto = mutation({
  args: {
    source: v.union(
      v.literal("copy"),
      v.literal("completion"),
      v.literal("boxArt"),
      v.literal("message"),
      v.literal("circleIcon"),
    ),
    imageId: v.string(),
  },
  handler: async (ctx, { source, imageId }) => {
    const adminId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    if (source === "copy") {
      const id = ctx.db.normalizeId("ownedPuzzleImages", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw notFound();
      if (!shouldRecheck(row.moderationStatus)) return;
      await ctx.db.patch(id, { ...backToPending, updatedAt: Date.now() });
      await enqueueImageModeration(ctx, "copy", id);
      const copy = await ctx.db.get(row.ownedPuzzleId);
      const title =
        copy?.snapshot?.title ??
        (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);
      await stampRecheck(ctx, adminId, imageId, title ?? imageId);
      return;
    }

    if (source === "completion") {
      const id = ctx.db.normalizeId("completionImages", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw notFound();
      if (!shouldRecheck(row.moderationStatus)) return;
      await ctx.db.patch(id, { ...backToPending, updatedAt: Date.now() });
      await enqueueImageModeration(ctx, "completion", id);
      const completion = await ctx.db
        .query("completions")
        .withIndex("by_aggregate_id", (q) =>
          q.eq("aggregateId", row.completionId),
        )
        .unique();
      await stampRecheck(
        ctx,
        adminId,
        imageId,
        completion?.copySnapshot?.title ?? "Completion photo",
      );
      return;
    }

    if (source === "message") {
      // A message photo (spec 2026-10-20 D5): its recipient keeps seeing "Pending review" until
      // the verdict lands through conversation/attachmentModerationStore.
      const id = ctx.db.normalizeId("messageAttachments", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || row?.kind !== "image") throw notFound();
      if (!shouldRecheck(row.moderationStatus)) return;
      await ctx.db.patch(id, { ...backToPending, updatedAt: Date.now() });
      await enqueueImageModeration(ctx, "message", id);
      await stampRecheck(ctx, adminId, imageId, MESSAGE_PHOTO_LABEL);
      return;
    }

    if (source === "circleIcon") {
      const id = ctx.db.normalizeId("circleIcons", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw notFound();
      if (!shouldRecheck(row.moderationStatus)) return;
      await ctx.db.patch(id, { ...backToPending, updatedAt: Date.now() });
      await enqueueImageModeration(ctx, "circleIcon", id);
      await stampRecheck(ctx, adminId, imageId, CIRCLE_ICON_LABEL);
      return;
    }

    const id = ctx.db.normalizeId("boxArtUploads", imageId);
    const row = id ? await ctx.db.get(id) : null;
    if (!id || !row) throw notFound();
    if (!shouldRecheck(row.moderationStatus)) return;
    await ctx.db.patch(id, { ...backToPending, recheckedAt: Date.now() });
    await enqueueImageModeration(ctx, "boxArt", id);
    await stampRecheck(
      ctx,
      adminId,
      imageId,
      (await boxArtTitle(ctx, row.storageId)) ?? "Box art",
    );
  },
});

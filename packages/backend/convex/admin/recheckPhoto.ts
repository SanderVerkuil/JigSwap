import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { enqueueImageModeration } from "../lib/imageModeration/moderationPool";

// Send an "unscored" photo through the shared moderation pipeline again: a copy photo
// (library/moderatePhoto), a completion photo (solving/moderateCompletionPhoto) or box art
// (catalog/moderateBoxArt), enqueued on the moderation Workpool like an upload's check. A photo whose check never
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

export const recheckPhoto = mutation({
  args: {
    source: v.union(
      v.literal("copy"),
      v.literal("completion"),
      v.literal("boxArt"),
      v.literal("message"),
    ),
    imageId: v.string(),
  },
  handler: async (ctx, { source, imageId }) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    if (source === "copy") {
      const id = ctx.db.normalizeId("ownedPuzzleImages", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw notFound();
      if (!shouldRecheck(row.moderationStatus)) return;
      await ctx.db.patch(id, { ...backToPending, updatedAt: Date.now() });
      await enqueueImageModeration(ctx, "copy", id);
      return;
    }

    if (source === "completion") {
      const id = ctx.db.normalizeId("completionImages", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw notFound();
      if (!shouldRecheck(row.moderationStatus)) return;
      await ctx.db.patch(id, { ...backToPending, updatedAt: Date.now() });
      await enqueueImageModeration(ctx, "completion", id);
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
      return;
    }

    const id = ctx.db.normalizeId("boxArtUploads", imageId);
    const row = id ? await ctx.db.get(id) : null;
    if (!id || !row) throw notFound();
    if (!shouldRecheck(row.moderationStatus)) return;
    await ctx.db.patch(id, { ...backToPending, recheckedAt: Date.now() });
    await enqueueImageModeration(ctx, "boxArt", id);
  },
});

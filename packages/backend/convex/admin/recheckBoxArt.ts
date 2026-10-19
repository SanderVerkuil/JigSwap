import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";

// Send "unscored" box art through the shared moderation pipeline again (catalog/moderateBoxArt):
// box art whose check never completed (the retries ran out, or the classifier was unavailable or
// misconfigured) is served to no one (lib/imageModeration/boxArtUrl) until it is approved. Once
// the classifier works again, an admin can re-check it instead of deciding it by hand
// (admin/decideUncheckedPhoto). Admin-only (isAdmin, server-side).
//
// The row goes back to "pending" with a fresh attempt count and the pipeline runs from attempt 1:
// steps already done (the re-encode, a passed hash check) are skipped, the classifier runs, and a
// retryable failure backs off as on upload. Only unscored rows: a pending one is still being
// checked (re-running it could race the scheduled retry), and a decided one is final.
export const recheckBoxArt = mutation({
  args: { imageId: v.string() },
  handler: async (ctx, { imageId }) => {
    await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const id = ctx.db.normalizeId("boxArtUploads", imageId);
    const row = id ? await ctx.db.get(id) : null;
    if (!id || !row) throw new ConvexError("Photo not found");
    if (row.moderationStatus !== "unscored") {
      throw new ConvexError("Only unchecked box art can be checked again");
    }
    await ctx.db.patch(id, {
      moderationStatus: "pending",
      moderationReason: undefined,
      moderationAttempts: undefined,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.catalog.moderateBoxArt.moderateBoxArt,
      { imageId: id, attempt: 1 },
    );
  },
});

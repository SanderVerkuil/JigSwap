import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { stampModerationAction } from "./stampModerationAction";

// Review-queue decision: the auto-rejection was a false positive, so the photo goes back to
// "approved" (visible in the gallery again). Only a rejected row can be restored.
export const restorePhoto = mutation({
  args: { imageId: v.id("ownedPuzzleImages") },
  handler: async (ctx, { imageId }) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const row = await ctx.db.get(imageId);
    if (!row) throw new ConvexError("Photo not found");
    if (row.moderationStatus !== "rejected") {
      throw new ConvexError("Photo is not rejected");
    }

    await ctx.db.patch(imageId, {
      moderationStatus: "approved",
      updatedAt: Date.now(),
    });

    // Audit trail: the same puzzle-title resolution as the pipeline's photo_auto_rejected stamp.
    const copy = await ctx.db.get(row.ownedPuzzleId);
    const title =
      copy?.snapshot?.title ??
      (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);
    await stampModerationAction(ctx, {
      actorId: memberId as unknown as Id<"users">,
      kind: "photo_restored",
      targetLabel: title ?? imageId,
      targetId: imageId,
    });
  },
});

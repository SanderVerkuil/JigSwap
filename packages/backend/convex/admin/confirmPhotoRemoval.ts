import { toMemberId } from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { makeNotify } from "../notifications/adapters/makeNotify";
import { deleteCopyPhoto } from "./deleteCopyPhoto";
import { stampModerationAction } from "./stampModerationAction";

// Review-queue decision: the auto-rejection stands, so the photo is removed for good — blob and
// row both deleted — the decision is stamped, and the uploader is told (via NotifyMember, so the
// member's notification preferences gate the channels as usual). Only a rejected row qualifies.
export const confirmPhotoRemoval = mutation({
  args: { imageId: v.id("ownedPuzzleImages") },
  handler: async (ctx, { imageId }) => {
    const memberId = await requireMember(ctx);
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const row = await ctx.db.get(imageId);
    if (!row) throw new ConvexError("Photo not found");
    if (row.moderationStatus !== "rejected") {
      throw new ConvexError("Photo is not rejected");
    }

    // Resolve the puzzle title BEFORE deleting (same resolution as photo_auto_rejected).
    const copy = await ctx.db.get(row.ownedPuzzleId);
    const title =
      copy?.snapshot?.title ??
      (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);

    await deleteCopyPhoto(ctx, row, copy);

    await stampModerationAction(ctx, {
      actorId: memberId as unknown as Id<"users">,
      kind: "photo_removal_confirmed",
      targetLabel: title ?? imageId,
      targetId: imageId,
    });

    // Tell the uploader; relatedId and subject point at the copy the photo belonged to. No actor:
    // the moderator is never exposed.
    const notify = makeNotify(ctx);
    await notify({
      memberId: toMemberId(row.uploaderId),
      type: "photo_removed",
      relatedId: row.ownedPuzzleId,
      subject: { kind: "copy", copyId: row.ownedPuzzleId },
    });
  },
});

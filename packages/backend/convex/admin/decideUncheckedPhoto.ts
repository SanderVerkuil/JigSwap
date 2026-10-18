import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { isAdmin } from "../identity/isAdmin";
import { requireMember } from "../identity/requireMember";
import { detachRejectedCompletionPhoto } from "../solving/completionModerationStore";
import { stampModerationAction } from "./stampModerationAction";

// Manual review of a photo the classifier has not decided ("pending" or "unscored"): an admin
// approves it (visible to everyone) or rejects it. Admin-only (isAdmin, server-side). The decision
// records `moderatedBy`, which makes it final: a late pipeline verdict is a no-op (first verdict
// wins on pending only) and the re-screen backfill skips the row. Stamped on the audit trail as
// photo_manually_approved / photo_manually_rejected with the admin as actor.
//
// A rejected COPY photo moves to the Flagged Images queue (status "rejected"), where it can be
// restored or its removal confirmed (which deletes it and notifies the uploader), exactly like an
// automatic rejection. A rejected COMPLETION photo gets the same side effects as an automatic
// rejection: it is detached from the completion and its blob deleted.
export const decideUncheckedPhoto = mutation({
  args: {
    source: v.union(v.literal("copy"), v.literal("completion")),
    imageId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("reject")),
  },
  handler: async (ctx, { source, imageId, decision }) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;
    if (!(await isAdmin(ctx))) throw new ConvexError("Forbidden");

    const status = decision === "approve" ? "approved" : "rejected";
    const kind =
      decision === "approve"
        ? "photo_manually_approved"
        : "photo_manually_rejected";
    const decided = {
      moderationStatus: status,
      moderationReason: undefined,
      moderatedBy: memberId,
      updatedAt: Date.now(),
    } as const;

    if (source === "copy") {
      const id = ctx.db.normalizeId("ownedPuzzleImages", imageId);
      const row = id ? await ctx.db.get(id) : null;
      if (!id || !row) throw new ConvexError("Photo not found");
      if (
        row.moderationStatus !== "pending" &&
        row.moderationStatus !== "unscored"
      ) {
        throw new ConvexError("Photo is already decided");
      }
      await ctx.db.patch(id, decided);
      const copy = await ctx.db.get(row.ownedPuzzleId);
      const title =
        copy?.snapshot?.title ??
        (copy ? (await ctx.db.get(copy.puzzleId))?.title : undefined);
      await stampModerationAction(ctx, {
        actorId: memberId,
        kind,
        targetLabel: title ?? imageId,
        targetId: imageId,
      });
      return;
    }

    const id = ctx.db.normalizeId("completionImages", imageId);
    const row = id ? await ctx.db.get(id) : null;
    if (!id || !row) throw new ConvexError("Photo not found");
    if (
      row.moderationStatus !== "pending" &&
      row.moderationStatus !== "unscored"
    ) {
      throw new ConvexError("Photo is already decided");
    }
    await ctx.db.patch(id, decided);
    const title =
      decision === "reject"
        ? await detachRejectedCompletionPhoto(ctx, row)
        : ((
            await ctx.db
              .query("completions")
              .withIndex("by_aggregate_id", (q) =>
                q.eq("aggregateId", row.completionId),
              )
              .unique()
          )?.copySnapshot?.title ?? "Completion photo");
    await stampModerationAction(ctx, {
      actorId: memberId,
      kind,
      targetLabel: title,
      targetId: row.completionId,
    });
  },
});

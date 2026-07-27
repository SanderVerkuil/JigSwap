import {
  makeAttachCompletionPhotos,
  type MemberId,
  toCompletionId,
  toFileId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { convexCompletionRepository } from "./adapters/convexCompletionRepository";
import { inProcessEventPublisher } from "./adapters/inProcessEventPublisher";
import { systemClock } from "./adapters/systemClock";
import { toConvexError } from "./errors";

// Composition root: author attaches uploaded photos to their completion. Window-free (see the
// domain method); every new photo gets a pending moderation sidecar + a scheduled moderation job
// (transactional with this mutation).
export const attachCompletionPhotos = mutation({
  args: {
    completionId: v.string(),
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const memberId = await requireMember(ctx);

    // Dedupe within the call and against already-attached photos.
    const row = await ctx.db
      .query("completions")
      .withIndex("by_aggregate_id", (q) =>
        q.eq("aggregateId", args.completionId),
      )
      .unique();
    if (!row) throw new ConvexError("Completion not found");
    const attached = new Set(row.photos as string[]);
    const newIds = [...new Set(args.storageIds as string[])].filter(
      (id) => !attached.has(id),
    );
    if (newIds.length === 0) return;

    const attachUseCase = makeAttachCompletionPhotos({
      completions: convexCompletionRepository(ctx),
      events: inProcessEventPublisher(ctx),
      clock: systemClock,
    });
    const result = await attachUseCase({
      actingMemberId: memberId as unknown as MemberId,
      completionId: toCompletionId(args.completionId),
      photoFileIds: newIds.map((id) => toFileId(id)),
    });
    if (result.isErr) throw toConvexError(result.error);

    const now = Date.now();
    for (const fileId of newIds) {
      const imageId = await ctx.db.insert("completionImages", {
        completionId: args.completionId,
        uploaderId: memberId as unknown as Id<"users">,
        fileId: fileId as Id<"_storage">,
        moderationStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.solving.moderateCompletionPhoto.moderateCompletionPhoto,
        { imageId },
      );
    }
  },
});

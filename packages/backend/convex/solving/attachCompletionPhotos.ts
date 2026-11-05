import {
  makeAttachCompletionPhotos,
  toCompletionId,
  toFileId,
  type MemberId,
} from "@jigswap/domain";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { enqueueImageModeration } from "../lib/imageModeration/moderationPool";
import { chargePhotoAttach } from "../lib/rateLimits";
import { assertClaimableUpload } from "../lib/storage/claimFreshUpload";
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

    // Dedupe within the call and against already-attached photos, so re-sending an attached id is
    // a no-op. Every other id must be a fresh upload nothing holds yet: a REJECTED photo's id
    // (dropped from `photos` by moderation) is still held by its sidecar or already deleted, so
    // it can never re-enter moderation (SEC-18).
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
    // A storage id someone learned (box art, another photo), a blob used once, a stale upload or
    // a CSAM-preserved blob refuses the whole call and is left alone (SEC-01, SEC-18).
    for (const id of newIds) {
      await assertClaimableUpload(ctx, id as Id<"_storage">);
    }

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

    // Each new photo runs the paid moderation pipeline: one charge per photo to the acting
    // member's photo bucket, before any sidecar or job exists. A refusal throws, which rolls the
    // whole call back (the completion's photos included).
    await chargePhotoAttach(ctx, memberId, newIds.length);

    const now = Date.now();
    for (const fileId of newIds) {
      const imageId = await ctx.db.insert("completionImages", {
        completionId: args.completionId,
        uploaderId: memberId as unknown as Id<"users">,
        fileId: fileId as Id<"_storage">,
        moderationStatus: "pending",
        // Publication gate: no URL until the CSAM hash check has passed (hashCheckFields).
        hashCheckPendingSince: now,
        createdAt: now,
        updatedAt: now,
      });
      await enqueueImageModeration(ctx, "completion", imageId);
    }
  },
});

import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isReferenced } from "../lib/imageModeration/blobReferences";
import { enqueueImageModeration } from "../lib/imageModeration/moderationPool";
import { enforceRateLimit } from "../lib/rateLimits";
import { requireCircleAdmin } from "./circleAccess";
import {
  CIRCLE_ICON_CLAIM_WINDOW_MS,
  CIRCLE_ICON_MAX_BYTES,
  CIRCLE_ICON_TYPES,
  circleIconRows,
  dropCircleIcon,
  isCircleIconServable,
} from "./circleIcons";

export type SetCircleIconResult =
  | { iconId: Id<"circleIcons"> }
  | { refused: "ImageTooLarge" | "UnsupportedImageType" | "UploadExpired" };

// Claim an uploaded blob as the circle's new icon (sharing/circleIcons.ts). Only for one of the
// circle's Admins (anyone else gets CircleNotFound), rate limited. The blob must exist and be
// referenced by nothing yet (else the generic InvalidUpload, and it is left alone). The CONTENT
// checks (at most CIRCLE_ICON_MAX_BYTES, JPEG/PNG/WebP, uploaded within the claim window) return
// `{ refused }` instead of throwing, so a refused fresh upload is deleted for good; a stale blob is
// refused but not deleted (as in conversation/stageMessageImage). The magic bytes are checked by
// the pipeline.
//
// Every row but the current icon goes (an older upload still in check, a refused one), so members
// keep the current icon until this one is approved. The row starts "pending" behind the hash gate,
// and the shared pipeline is enqueued in the same transaction.
export const setCircleIcon = mutation({
  args: { circleId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<SetCircleIconResult> => {
    const me = (await requireMember(ctx)) as unknown as Id<"users">;
    const circle = await requireCircleAdmin(ctx, args.circleId, me);
    await enforceRateLimit(ctx, "circleIcon", me);

    const blob = await ctx.db.system.get(args.storageId);
    if (!blob || (await isReferenced(ctx, args.storageId))) {
      throw new ConvexError({
        code: "InvalidUpload",
        message: "This upload can't be used",
      });
    }
    const now = Date.now();
    if (now - blob._creationTime > CIRCLE_ICON_CLAIM_WINDOW_MS) {
      return { refused: "UploadExpired" };
    }
    const refusal =
      blob.size > CIRCLE_ICON_MAX_BYTES
        ? ("ImageTooLarge" as const)
        : !CIRCLE_ICON_TYPES.includes(blob.contentType ?? "")
          ? ("UnsupportedImageType" as const)
          : null;
    if (refusal) {
      await ctx.storage.delete(args.storageId);
      return { refused: refusal };
    }

    const circleId = circle.aggregateId ?? args.circleId;
    const rows = await circleIconRows(ctx, circleId);
    const current = rows.find(isCircleIconServable);
    for (const row of rows) {
      if (row !== current) await dropCircleIcon(ctx, row);
    }
    const iconId = await ctx.db.insert("circleIcons", {
      circleId,
      uploaderId: me,
      fileId: args.storageId,
      moderationStatus: "pending",
      hashCheckPendingSince: now,
      createdAt: now,
      updatedAt: now,
    });
    await enqueueImageModeration(ctx, "circleIcon", iconId);
    return { iconId };
  },
});

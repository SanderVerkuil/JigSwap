import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { canManageCopy } from "../household/copyAccess";
import { requireMember } from "../identity/requireMember";
import { enqueueImageModeration } from "../lib/imageModeration/moderationPool";
import { chargePhotoAttach } from "../lib/rateLimits";
import { assertClaimableUpload } from "../lib/storage/claimFreshUpload";

// Composition root for attaching an uploaded photo to an owned copy, keyed by the copy's Convex id.
// Pairs with `generateUploadUrl`: the client uploads the blob, then calls this with the returned
// storageId. A plain Convex mutation that writes the `ownedPuzzleImages` read-model directly (the
// gallery in getCopyInstanceView reads the same table). Only the copy's owner (or a household member
// with manage permission) may add a photo to it, and only a fresh upload nothing holds yet
// (lib/storage/claimFreshUpload).
export const addCopyPhoto = mutation({
  args: {
    copyId: v.id("ownedPuzzles"),
    fileId: v.id("_storage"),
    tag: v.optional(
      v.union(
        v.literal("box_front"),
        v.literal("box_back"),
        v.literal("pieces"),
        v.literal("completed"),
        v.literal("damage_detail"),
      ),
    ),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const memberId = (await requireMember(ctx)) as unknown as Id<"users">;

    const copy = await ctx.db.get(args.copyId);
    if (!copy) throw new ConvexError("Copy not found");
    // Owner, or a household member the owner left at "manage" (co-owner).
    if (!(await canManageCopy(ctx, memberId, copy))) {
      throw new ConvexError("Only the owner can add a photo to this copy");
    }

    // A storage id someone learned (box art, another photo), a blob used once, a stale upload or
    // a CSAM-preserved blob is refused and left alone (SEC-01, SEC-18).
    await assertClaimableUpload(ctx, args.fileId);

    // The photo runs the paid moderation pipeline: charged to the acting member's photo bucket
    // before the row and its job exist.
    await chargePhotoAttach(ctx, memberId);

    const now = Date.now();
    // Inserted as "pending": the async moderatePhoto pipeline re-encodes (strips EXIF) and
    // content-classifies the photo, then flips it to approved/rejected. Until then only the
    // uploader sees it in the gallery (see getCopyInstanceView).
    const imageId = await ctx.db.insert("ownedPuzzleImages", {
      ownedPuzzleId: args.copyId,
      uploaderId: memberId,
      fileId: args.fileId,
      title: args.title,
      tag: args.tag,
      moderationStatus: "pending",
      // Publication gate: no URL for this photo, to anyone, until the CSAM hash check has passed
      // (lib/imageModeration/hashCheckFields).
      hashCheckPendingSince: now,
      createdAt: now,
      updatedAt: now,
    });

    // Kick the async moderation pipeline on the moderation Workpool (as soon as this mutation
    // commits). Enqueueing is transactional with the insert, so the job only exists if the row does.
    await enqueueImageModeration(ctx, "copy", imageId);
  },
});

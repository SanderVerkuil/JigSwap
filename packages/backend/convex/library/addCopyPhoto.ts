import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation } from "../_generated/server";
import { requireMember } from "../identity/requireMember";

// Composition root for attaching an uploaded photo to an owned copy, keyed by the copy's Convex id.
// Pairs with `generateUploadUrl`: the client uploads the blob, then calls this with the returned
// storageId. A plain Convex mutation that writes the `ownedPuzzleImages` read-model directly (the
// gallery in getCopyInstanceView reads the same table). Owner-only: only the copy's owner may add a
// photo to it.
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
    if (copy.ownerId !== memberId) {
      throw new ConvexError("Only the owner can add a photo to this copy");
    }

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
      createdAt: now,
      updatedAt: now,
    });

    // Kick the async moderation pipeline (runAfter 0 = as soon as this mutation commits). Scheduling
    // is transactional with the insert, so the job is only enqueued if the row is actually written.
    await ctx.scheduler.runAfter(
      0,
      internal.library.moderatePhoto.moderatePhoto,
      { imageId },
    );
  },
});

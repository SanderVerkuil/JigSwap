"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { MAX_IMAGE_UPLOAD_BYTES } from "../lib/imageModeration/guards";
import { boxArtRefused } from "./boxArtUploads";
import { cleanBoxArt } from "./cleanBoxArt";

// Clean an uploaded box-art file (see boxArtUploads): strip its metadata and turn it upright
// (cleanBoxArt; Node, for the decoder), store the clean bytes as a new blob listed for the
// member, delete the upload. Returns the clean storage id, which is what the catalog mutations
// take as `image`. A refused upload is deleted too.
export const sanitizeBoxArt = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<Id<"_storage">> => {
    const uploaderId = await ctx.runQuery(
      internal.catalog.boxArtUploads.currentMember,
      {},
    );
    const upload = await ctx.runQuery(
      internal.catalog.boxArtUploads.claimableUpload,
      { storageId },
    );
    if (!upload) {
      throw new ConvexError({
        code: "InvalidUpload",
        message: "This upload can't be used",
      });
    }
    if (upload.size > MAX_IMAGE_UPLOAD_BYTES) {
      await ctx.storage.delete(storageId);
      throw boxArtRefused("too_large");
    }
    const blob = await ctx.storage.get(storageId);
    if (!blob) {
      throw new ConvexError({
        code: "InvalidUpload",
        message: "This upload can't be used",
      });
    }
    const clean = await cleanBoxArt(new Uint8Array(await blob.arrayBuffer()));
    await ctx.storage.delete(storageId);
    if (!clean.ok) throw boxArtRefused(clean.reason);

    const cleanId = await ctx.storage.store(
      new Blob([clean.bytes as BlobPart], { type: clean.mime }),
    );
    await ctx.runMutation(internal.catalog.boxArtUploads.register, {
      storageId: cleanId,
      uploaderId,
    });
    return cleanId;
  },
});

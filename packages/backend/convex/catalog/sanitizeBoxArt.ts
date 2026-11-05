"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { checkBoxArt } from "./moderateBoxArt";

// Check an uploaded box-art file before it can be used (see boxArtUploads): the shared
// image-moderation pipeline runs on it now (catalog/moderateBoxArt.checkBoxArt): input guards,
// metadata strip + turned upright, CSAM hash check, content classification. Returns the clean
// storage id, which is what the catalog mutations take as `image`; a refused upload throws
// "InvalidImage" and its blob is deleted. Each check is first charged to the member's box-art
// bucket (boxArtUploads.chargeBoxArtCheck); a refusal ("RateLimited") claims nothing.
export const sanitizeBoxArt = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<Id<"_storage">> => {
    await ctx.runMutation(internal.catalog.boxArtUploads.chargeBoxArtCheck, {});
    return checkBoxArt(ctx, storageId);
  },
});

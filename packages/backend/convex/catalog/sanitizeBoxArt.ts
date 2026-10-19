"use node";

import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { checkBoxArt } from "./moderateBoxArt";

// Check an uploaded box-art file before it can be used (see boxArtUploads): the shared
// image-moderation pipeline runs on it now (catalog/moderateBoxArt.checkBoxArt): input guards,
// metadata strip + turned upright, CSAM hash check, content classification. Returns the clean
// storage id, which is what the catalog mutations take as `image`; a refused upload throws
// "InvalidImage" and its blob is deleted.
export const sanitizeBoxArt = action({
  args: { storageId: v.id("_storage") },
  handler: (ctx, { storageId }): Promise<Id<"_storage">> =>
    checkBoxArt(ctx, storageId),
});

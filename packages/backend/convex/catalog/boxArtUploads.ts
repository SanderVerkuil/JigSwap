import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { requireMember } from "../identity/requireMember";
import { isReferenced } from "../lib/imageModeration/blobReferences";

// Box art (a puzzle definition's `image`, or a proposed one) is served to everyone, so it must
// never carry the uploader's EXIF/GPS. The client uploads the file, then calls
// catalog/sanitizeBoxArt, which strips the metadata and turns the pixels upright
// (catalog/cleanBoxArt), stores the clean bytes as a new blob, deletes the upload and lists the
// clean blob in `boxArtUploads` for that member (catalog/importPuzzleImage does the same for a
// fetched shop image). The catalog mutations only take a NEW image listed there for the acting
// member (assertBoxArtImage).

/** An upload must be cleaned within this long of its creation. */
export const BOX_ART_CLAIM_WINDOW_MS = 15 * 60_000;

/** Why box art was refused (the ConvexError code is "InvalidImage"). */
export type BoxArtRefusal =
  | "too_large"
  | "unsupported_format"
  | "unreadable_header"
  | "too_many_pixels"
  | "malformed";

export const boxArtRefused = (reason: BoxArtRefusal) =>
  new ConvexError({
    code: "InvalidImage",
    message: "This image can't be used",
    reason,
  });

/** The acting member (an action has no ctx.db). */
export const currentMember = internalQuery({
  args: {},
  handler: async (ctx) => (await requireMember(ctx)) as unknown as Id<"users">,
});

/**
 * Whether the upload may be cleaned: it exists, is fresh, and nothing references it yet (so the
 * strip, which deletes it, can never destroy another photo). Returns its size, or null.
 */
export const claimableUpload = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const blob = await ctx.db.system.get(storageId);
    if (!blob || Date.now() - blob._creationTime > BOX_ART_CLAIM_WINDOW_MS) {
      return null;
    }
    if (await isReferenced(ctx, storageId)) return null;
    return { size: blob.size };
  },
});

/** List a clean blob as box art the member may use. */
export const register = internalMutation({
  args: { storageId: v.id("_storage"), uploaderId: v.id("users") },
  handler: async (ctx, { storageId, uploaderId }) => {
    await ctx.db.insert("boxArtUploads", {
      storageId,
      uploaderId,
      createdAt: Date.now(),
    });
  },
});

/**
 * A catalog mutation's `image` arg must be unchanged (one of `current`: the definition's image,
 * or the proposal's) or box art cleaned for the acting member. Anything else, such as a raw
 * upload straight from generateUploadUrl, is refused.
 */
export const assertBoxArtImage = async (
  ctx: QueryCtx,
  image: string | undefined,
  member: Id<"users">,
  current: ReadonlyArray<string | undefined> = [],
): Promise<void> => {
  if (image === undefined || current.includes(image)) return;
  const storageId = ctx.db.system.normalizeId("_storage", image);
  const row =
    storageId &&
    (await ctx.db
      .query("boxArtUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first());
  if (!row || row.uploaderId !== member) {
    throw new ConvexError({
      code: "InvalidImage",
      message: "This image can't be used",
    });
  }
};

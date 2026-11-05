import { ConvexError } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { isReferenced } from "../imageModeration/blobReferences";

// How long after its upload a blob can still be claimed as a copy or completion photo. Same as
// the box-art, message-photo and circle-icon claim windows: the client attaches right after the
// upload POST.
export const UPLOAD_CLAIM_WINDOW_MS = 15 * 60_000;

/**
 * The claim rule for a member-supplied storage id (SEC-01): the blob exists, nothing holds it yet
 * (no photo, icon, box art, listing, report evidence, and no CSAM escalation;
 * lib/imageModeration/blobReferences), and it was uploaded within UPLOAD_CLAIM_WINDOW_MS. So a
 * storage id someone learned can never be attached to their own row (where removing it, or the
 * pipeline's swap, would delete it), and a blob used once (crashed in its check, refused,
 * removed) cannot be fed to moderation again (SEC-18).
 *
 * A missing, held or preserved blob is the generic InvalidUpload, one answer for all, so nothing
 * about an escalation is revealed. A stale blob is UploadExpired and is left alone: it may be
 * held where no index can tell (a legacy completion photo), and deleting it on request would let
 * anyone destroy it. Throws, so the calling mutation writes nothing.
 */
export const assertClaimableUpload = async (
  ctx: QueryCtx,
  storageId: Id<"_storage">,
): Promise<void> => {
  const blob = await ctx.db.system.get(storageId);
  if (!blob || (await isReferenced(ctx, storageId))) {
    throw new ConvexError({
      code: "InvalidUpload",
      message: "This upload can't be used",
    });
  }
  if (Date.now() - blob._creationTime > UPLOAD_CLAIM_WINDOW_MS) {
    throw new ConvexError({
      code: "UploadExpired",
      message: "This upload has expired; upload the photo again",
    });
  }
};

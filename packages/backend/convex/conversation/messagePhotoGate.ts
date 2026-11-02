import type { Doc } from "../_generated/dataModel";

// The publication gate of a message photo, on its own so that lib/imageModeration/renditionsStore
// can ask it without pulling the rest of conversation/messageAttachments into its Node action.

type ImageAttachment = Extract<Doc<"messageAttachments">, { kind: "image" }>;

// The verdicts that let a photo be shown to someone other than its sender. "unscored" (the check
// could not run) is NOT one: it waits for a moderator (admin/listUncheckedPhotos).
const SERVABLE: ReadonlySet<ImageAttachment["moderationStatus"]> = new Set([
  "approved",
  "blurred",
]);

/**
 * Whether the photo may be served to a reader other than its sender: an approving verdict (incl.
 * the sensitive "blurred" band, which still needs Show), a passed CSAM hash check, and its blob
 * swapped to the pipeline's re-encode (never the upload as sent, with its EXIF/GPS). THE gate of
 * every recipient-facing read: the thread read model, revealMessageImage and attachment reports.
 */
export const isServable = (row: ImageAttachment): boolean =>
  SERVABLE.has(row.moderationStatus) &&
  row.hashCheckedAt !== undefined &&
  row.reencodedAt !== undefined;

import { err, Id, ok, Result } from "../../shared-kernel";
import { LibraryError } from "./errors";

// A reference to an uploaded image file. The actual storage id is owned by an adapter
// (Convex `_storage`); the domain only carries an opaque branded handle.
export type FileId = Id<"FileId">;

// Bounds on a copy's photos: every photo runs the paid moderation pipeline and is read with the
// copy's gallery. Checked when a photo is added (the backend's addCopyPhoto, the only path that
// adds one), never on rehydrate, so photos stored before the bounds existed stay.
export const MAX_COPY_IMAGES = 20;
export const MAX_COPY_IMAGE_TITLE_LENGTH = 200;
export const MAX_COPY_IMAGE_DESCRIPTION_LENGTH = 2_000;

// Whether a new photo's title and description are within their bounds.
export const checkCopyImageText = (text: {
  readonly title?: string;
  readonly description?: string;
}): Result<void, LibraryError> => {
  if ((text.title?.length ?? 0) > MAX_COPY_IMAGE_TITLE_LENGTH) {
    return err(
      LibraryError.imageTextTooLong("title", MAX_COPY_IMAGE_TITLE_LENGTH),
    );
  }
  if ((text.description?.length ?? 0) > MAX_COPY_IMAGE_DESCRIPTION_LENGTH) {
    return err(
      LibraryError.imageTextTooLong(
        "description",
        MAX_COPY_IMAGE_DESCRIPTION_LENGTH,
      ),
    );
  }
  return ok(undefined);
};

// The kind of photo, matching the persisted `ownedPuzzleImages.tag` union.
export type CopyImageTag =
  "box_front" | "box_back" | "pieces" | "completed" | "damage_detail";

// A photo of a physical Copy. Value object owned by the Copy aggregate (images belong to the
// Copy, per §1.4). Mirrors the user-provided metadata on `ownedPuzzleImages`.
export class CopyImage {
  private constructor(
    readonly fileId: FileId,
    readonly title?: string,
    readonly description?: string,
    readonly tag?: CopyImageTag,
    readonly takenAt?: Date,
  ) {}

  static create(props: {
    readonly fileId: FileId;
    readonly title?: string;
    readonly description?: string;
    readonly tag?: CopyImageTag;
    readonly takenAt?: Date;
  }): CopyImage {
    return new CopyImage(
      props.fileId,
      props.title,
      props.description,
      props.tag,
      props.takenAt,
    );
  }
}

import { Id } from "../../shared-kernel";

// A reference to an uploaded image file. The actual storage id is owned by an adapter
// (Convex `_storage`); the domain only carries an opaque branded handle.
export type FileId = Id<"FileId">;

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

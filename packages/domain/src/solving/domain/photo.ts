import { Id } from "../../shared-kernel";

// A reference to an uploaded image file. The actual storage id is owned by an adapter
// (Convex `_storage` — the persisted `completions.photos[]`); the domain only carries an opaque
// branded handle.
export type FileId = Id<"FileId">;

// A photo attached to a Completion. Value object owned by the Completion aggregate; a completion
// holds up to five of them (§1.4). Mirrors an entry in the persisted `completions.photos` array.
export class Photo {
  private constructor(readonly fileId: FileId) {}

  static of(fileId: FileId): Photo {
    return new Photo(fileId);
  }

  equals(other: Photo): boolean {
    return this.fileId === other.fileId;
  }
}

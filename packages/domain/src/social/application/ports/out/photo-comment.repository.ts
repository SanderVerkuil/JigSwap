import { PhotoComment, PhotoCommentId } from "../../../domain";

// Outbound port: persistence for the PhotoComment aggregate. Posting only ever inserts (`save`);
// the author may delete their own photo comment, which needs it back by id (`findById`, null when
// there is none) and removed (`remove`). The read side projects the `photoComments` table directly
// into view DTOs and does not go through this port.
export interface PhotoCommentRepository {
  save(comment: PhotoComment): Promise<void>;
  findById(id: PhotoCommentId): Promise<PhotoComment | null>;
  remove(comment: PhotoComment): Promise<void>;
}

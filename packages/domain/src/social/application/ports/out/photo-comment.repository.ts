import { PhotoComment } from "../../../domain";

// Outbound port: persistence for the PhotoComment aggregate. Photo comments are append-only (no
// edit/delete in this use case), so the port only needs `save`; the read side projects the
// `photoComments` table directly into view DTOs and does not load the aggregate back.
export interface PhotoCommentRepository {
  save(comment: PhotoComment): Promise<void>;
}

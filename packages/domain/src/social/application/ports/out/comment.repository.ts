import { Comment } from "../../../domain";

// Outbound port: persistence for the community Comment aggregate. A comment is append-only (no
// edit/delete in this use case), so the port only needs `save`; the read side projects the
// `puzzleComments` table directly into view DTOs and does not load the aggregate back.
export interface CommentRepository {
  save(comment: Comment): Promise<void>;
}

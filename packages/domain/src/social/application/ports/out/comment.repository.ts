import { Comment, CommentId } from "../../../domain";

// Outbound port: persistence for the community Comment aggregate. Posting only ever inserts
// (`save`); the author may delete their own comment, which needs it back by id (`findById`, null
// when there is none) and removed (`remove`). The read side projects the `puzzleComments` table
// directly into view DTOs and does not go through this port.
export interface CommentRepository {
  save(comment: Comment): Promise<void>;
  findById(id: CommentId): Promise<Comment | null>;
  remove(comment: Comment): Promise<void>;
}
